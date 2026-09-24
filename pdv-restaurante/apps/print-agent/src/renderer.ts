/**
 * Layout da comanda + serialização ESC/POS.
 * Sem dependências nativas: ESC/POS é montado na mão (bytes) e enviado
 * via TCP :9100 (RAW) — funciona com Epson TM, Elgin i9, Bematech MP.
 */

export interface TicketItem {
  quantidade: string | number;
  produto: string;
  observacao?: string | null;
  ponto_carne?: string | null;
}

export interface JobDetail {
  id: number;
  tipo: 'PRODUCAO' | 'CANCELAMENTO' | string;
  remessa_id: number;
  remessa_tipo: string;
  mesa_numero: number;
  garcom_nome?: string | null;
  enviado_por_nome?: string | null;
  restaurante_nome?: string | null;
  enviado_em?: string;
  estacao_nome: string;
  conteudo?: string | null;
  itens: TicketItem[];
}

/** Térmicas falam ASCII/CP437 — remove acentos e pontuação "smart" (—, “…”, …)
 *  para nunca sair "?" no papel. */
const PUNCT_MAP: Record<string, string> = {
  '—': '-', '–': '-', '‐': '-', '“': '"', '”': '"', '‘': "'", '’': "'",
  '…': '...', '•': '*', '°': '', 'º': '', 'ª': '',
};
export function stripAccents(s: string): string {
  const semAcento = (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return semAcento.replace(/[—–‐“”‘’…•°ºª]/g, (c) => PUNCT_MAP[c] ?? '');
}

export function formatQtd(q: string | number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const raw of String(text).split('\n')) {
    let line = raw;
    while (line.length > cols) {
      let cut = line.lastIndexOf(' ', cols);
      if (cut <= 0) cut = cols;
      out.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    out.push(line);
  }
  return out;
}

function center(s: string, cols: number): string {
  const t = s.slice(0, cols);
  const pad = Math.max(0, Math.floor((cols - t.length) / 2));
  return ' '.repeat(pad) + t;
}

function row(left: string, right: string, cols: number): string {
  const r = right.slice(0, cols);
  const l = left.slice(0, Math.max(0, cols - r.length - 1));
  return l + ' '.repeat(Math.max(1, cols - l.length - r.length)) + r;
}

function hora(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Texto puro da comanda (também é o que o modo virtual salva e o que o
 * agente devolve em `conteudo` para conferência na demo/KDS).
 */
export function buildTicketText(job: JobDetail, cols = 48): string {
  const L: string[] = [];
  const line = '-'.repeat(cols);
  const nome = stripAccents(job.restaurante_nome || 'Restaurante').toUpperCase();
  const horaEnvio = hora(job.enviado_em);

  if (job.tipo === 'CANCELAMENTO') {
    L.push(center('!!! CANCELAMENTO !!!', cols));
    L.push(center(stripAccents(job.estacao_nome || '').toUpperCase(), cols));
    L.push(row(`MESA ${job.mesa_numero}`, horaEnvio, cols));
    L.push(line);
    // conteúdo montado pelo trigger (1..N linhas "CANCELADO: ...")
    for (const t of wrap(stripAccents(job.conteudo || '(sem detalhe)'), cols)) L.push(t);
    L.push(line);
    L.push(`Remessa #${job.remessa_id}`);
  } else {
    L.push(center(nome, cols));
    L.push(center(`*** ${stripAccents(job.estacao_nome || '').toUpperCase()} - ${job.remessa_tipo} ***`, cols));
    L.push(row(`MESA ${job.mesa_numero}`, horaEnvio, cols));
    const quem = stripAccents(job.garcom_nome || job.enviado_por_nome || '');
    if (quem) L.push(`Garcom: ${quem}`.slice(0, cols));
    L.push(line);
    for (const it of job.itens || []) {
      for (const t of wrap(`${formatQtd(it.quantidade)}x ${stripAccents(it.produto)}`, cols)) L.push(t);
      if (it.observacao) {
        for (const t of wrap(`> ${stripAccents(it.observacao)}`, cols - 3)) L.push('   ' + t);
      }
      if (it.ponto_carne) {
        for (const t of wrap(`> Ponto: ${stripAccents(it.ponto_carne)}`, cols - 3)) L.push('   ' + t);
      }
    }
    L.push(line);
    L.push(`Remessa #${job.remessa_id} - job #${job.id}`.slice(0, cols));
  }
  return L.join('\n');
}

// ---- ESC/POS ----
// Comandos usados (universais Epson/Elgin/Bematech):
const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40]; // ESC @ — reseta
const ALIGN_L = [ESC, 0x61, 0x00];
const ALIGN_C = [ESC, 0x61, 0x01];
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const SIZE_2X = [GS, 0x21, 0x11]; // 2x largura+altura
const SIZE_1X = [GS, 0x21, 0x00];
const CUT = [GS, 0x56, 0x00]; // corte total
const BEL = [0x07]; // bipe (a maioria obedece)

/**
 * Converte o texto em bytes ESC/POS: títulos (*** ou !!!) saem em destaque
 * (centralizado, 2x), o resto em texto corrido. Termina com avanço + corte.
 */
export function toEscPos(text: string, opts: { beep?: boolean } = {}): Buffer {
  const bytes: number[] = [...INIT];
  if (opts.beep) bytes.push(...BEL);
  const lines = String(text).split('\n');
  for (const raw of lines) {
    const t = raw.trim();
    const titulo = /^\*{3}.*\*{3}$|^!{3}.*!{3}$/.test(t) || /^MESA \d+/.test(t);
    if (titulo) {
      bytes.push(...ALIGN_C, ...SIZE_2X, ...BOLD_ON);
      bytes.push(...Buffer.from(raw.slice(0, 24), 'latin1'), 0x0a);
      bytes.push(...SIZE_1X, ...BOLD_OFF, ...ALIGN_L);
    } else {
      bytes.push(...Buffer.from(raw, 'latin1'), 0x0a);
    }
  }
  bytes.push(0x0a, 0x0a, 0x0a, ...CUT);
  return Buffer.from(bytes);
}

/** Colunas por largura de papel: 80mm=48 col · 58mm=32 · 76mm=42. */
export function colsForPaper(papelMm?: number | null): number {
  if (Number(papelMm) === 58) return 32;
  if (Number(papelMm) === 76) return 42;
  return 48;
}
