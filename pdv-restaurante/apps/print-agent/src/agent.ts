import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { io, Socket } from 'socket.io-client';
import { AgentConfig } from './config';
import { ApiClient, EstacaoInfo, FilaJob } from './api';
import { buildTicketText, colsForPaper, toEscPos } from './renderer';
import { printTcp } from './printer';

const log = (...a: any[]) => console.log(`[print-agent ${new Date().toLocaleTimeString('pt-BR')}]`, ...a);

/**
 * Loop do agente: polling da fila (PENDENTE + FALHA p/ retry) com wake
 * imediato via WebSocket (pedido.enviado / item.status / impressao.reprint).
 * Jobs são processados em sequência (1 de cada vez — impressora é serial).
 */
export class PrintAgent {
  private timer?: NodeJS.Timeout;
  private socket?: Socket;
  private running = false;
  private polling = false;
  private wakeT?: NodeJS.Timeout;
  private estacoesCache: { at: number; list: EstacaoInfo[] } | null = null;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly api: ApiClient,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    log(`iniciado — api=${this.cfg.apiUrl} modo=${this.cfg.modo} poll=${this.cfg.pollMs}ms` +
      (this.cfg.estacaoIds ? ` estacoes=[${this.cfg.estacaoIds.join(',')}]` : ' estacoes=todas'));
    if (this.cfg.modo === 'virtual') {
      mkdirSync(this.cfg.ticketsDir, { recursive: true });
      log(`modo virtual — tickets em ${this.cfg.ticketsDir}/ (nenhuma impressora será tocada)`);
    }
    this.connectWs();
    this.timer = setInterval(() => this.poll(), this.cfg.pollMs);
    void this.poll();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.wakeT) clearTimeout(this.wakeT);
    this.socket?.disconnect();
    // espera um poll em andamento terminar (até 15s)
    for (let i = 0; i < 150 && this.polling; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private connectWs() {
    try {
      this.socket = io(this.cfg.apiUrl, { transports: ['websocket', 'polling'], reconnection: true });
      this.socket.on('connect', () => {
        this.socket?.emit('join', { rooms: ['cozinha', 'bar', 'caixa'] });
        log('WS conectado — wake imediato ativo');
      });
      for (const ev of ['pedido.enviado', 'item.status', 'impressao.reprint']) {
        this.socket.on(ev, () => this.wake());
      }
      this.socket.on('connect_error', () => {
        /* polling cobre; evita spam de log */
      });
    } catch {
      /* sem WS: polling segue funcionando */
    }
  }

  private wake() {
    if (!this.running || this.polling) return;
    if (this.wakeT) clearTimeout(this.wakeT);
    this.wakeT = setTimeout(() => this.poll(), 400);
  }

  async poll(): Promise<{ impressos: number; falhas: number }> {
    if (!this.running || this.polling) return { impressos: 0, falhas: 0 };
    this.polling = true;
    let impressos = 0;
    let falhas = 0;
    try {
      const [pend, falha] = await Promise.all([
        this.api.fila('PENDENTE'),
        this.api.fila('FALHA'),
      ]);
      const jobs = [...pend, ...falha]
        .filter((j) => !this.cfg.estacaoIds || this.cfg.estacaoIds.includes(Number(j.estacao_id)))
        .filter((j) => Number(j.tentativas) < this.cfg.maxTentativas)
        .sort((a, b) => a.id - b.id);
      if (jobs.length) log(`${jobs.length} job(s) na fila`);
      for (const job of jobs) {
        if (!this.running) break;
        try {
          await this.processJob(job);
          impressos++;
        } catch (e: any) {
          falhas++;
          log(`job #${job.id} FALHOU: ${e?.message || e}`);
          try {
            await this.api.ack(job.id, 'FALHA');
          } catch {
            /* API fora do ar — tenta de novo no próximo poll */
          }
        }
      }
    } catch (e: any) {
      log(`poll falhou (API fora do ar?): ${e?.message || e}`);
    } finally {
      this.polling = false;
    }
    return { impressos, falhas };
  }

  private async getEstacao(id: number): Promise<EstacaoInfo | undefined> {
    const now = Date.now();
    if (!this.estacoesCache || now - this.estacoesCache.at > 60_000) {
      const list = await this.api.estacoes();
      this.estacoesCache = { at: now, list };
    }
    return this.estacoesCache.list.find((e) => Number(e.id) === Number(id));
  }

  private async processJob(job: FilaJob): Promise<void> {
    const detail = await this.api.job(job.id);
    const est = await this.getEstacao(Number(job.estacao_id));
    const cols = colsForPaper((est as any)?.papel_mm);
    const texto = buildTicketText(detail, cols);

    if (this.cfg.modo === 'virtual') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(
        this.cfg.ticketsDir,
        `${stamp}-job${job.id}-mesa${detail.mesa_numero}-${(detail.estacao_nome || 'estacao').replace(/\s+/g, '_')}.txt`,
      );
      writeFileSync(file, `=== VIRTUAL — ${new Date().toLocaleString('pt-BR')} ===\n${texto}\n`);
      log(`job #${job.id} [${detail.tipo}] mesa ${detail.mesa_numero}/${detail.estacao_nome} → ${file}`);
      console.log('----- ticket -----\n' + texto + '\n------------------');
    } else {
      const ip = (est as any)?.ip;
      const porta = Number((est as any)?.porta || 9100);
      if (!ip) {
        throw new Error(`estação ${job.estacao_id} sem impressora cadastrada (tabela impressora)`);
      }
      await printTcp(ip, porta, toEscPos(texto, { beep: this.cfg.beep }));
      log(`job #${job.id} [${detail.tipo}] mesa ${detail.mesa_numero} impresso em ${ip}:${porta}`);
    }
    // guarda o texto renderizado no job (conferência na demo/KDS)
    await this.api.ack(job.id, 'IMPRESSA', texto);
  }
}
