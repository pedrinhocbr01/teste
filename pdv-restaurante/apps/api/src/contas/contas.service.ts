import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import { toCents, toReais, br } from '../common/money';
import { PdvGateway } from '../ws/pdv.gateway';
import {
  AlocarItemDto,
  AtualizarContaDto,
  CancelarPagamentoDto,
  CriarContaDto,
  CriarPagamentoDto,
  DividirIgualDto,
} from './dto';

@Injectable()
export class ContasService {
  constructor(
    private readonly db: DbService,
    private readonly ws: PdvGateway,
  ) {}

  // ---------- leitura ----------

  private async resumo(contaId: number): Promise<any | null> {
    return this.db.queryOne(`SELECT * FROM vw_conta_resumo WHERE conta_id = $1`, [contaId]);
  }

  async detalhar(contaId: number) {
    const conta = await this.db.queryOne<any>(
      `SELECT c.*, p.mesa_id, m.numero AS mesa_numero
       FROM conta c JOIN pedido p ON p.id = c.pedido_id JOIN mesa m ON m.id = p.mesa_id
       WHERE c.id = $1`,
      [contaId],
    );
    if (!conta) throw new NotFoundException('Conta não encontrada');
    const resumo = await this.resumo(contaId);
    const itens = await this.db.query(
      `SELECT ci.id, ci.quantidade, pi.id AS pedido_item_id, pi.status AS item_status,
              p.nome AS produto, pi.preco_unitario
       FROM conta_item ci
       JOIN pedido_item pi ON pi.id = ci.pedido_item_id
       JOIN produto p ON p.id = pi.produto_id
       WHERE ci.conta_id = $1 ORDER BY ci.id`,
      [contaId],
    );
    const pagamentos = await this.listarPagamentos(contaId);
    return {
      ...conta,
      servico_pct: num(conta.servico_pct),
      desconto_valor: num(conta.desconto_valor),
      valor_rateio: conta.valor_rateio == null ? null : num(conta.valor_rateio),
      resumo: resumo && {
        subtotal_itens: num(resumo.subtotal_itens),
        servico_valor: num(resumo.servico_valor),
        total: num(resumo.total),
        pago: num(resumo.pago),
        saldo: num(resumo.saldo),
      },
      itens: itens.map((i: any) => ({
        ...i,
        quantidade: num(i.quantidade),
        preco_unitario: num(i.preco_unitario),
      })),
      pagamentos,
    };
  }

  async listarPorPedido(pedidoId: number) {
    const rows = await this.db.query<any>(
      `SELECT c.*, r.subtotal_itens, r.servico_valor, r.total, r.pago, r.saldo,
              (SELECT COUNT(*) FROM conta_item ci WHERE ci.conta_id = c.id)::int AS n_itens
       FROM conta c LEFT JOIN vw_conta_resumo r ON r.conta_id = c.id
       WHERE c.pedido_id = $1 ORDER BY c.id`,
      [pedidoId],
    );
    return rows.map((r: any) => ({
      ...r,
      servico_pct: num(r.servico_pct),
      desconto_valor: num(r.desconto_valor),
      valor_rateio: r.valor_rateio == null ? null : num(r.valor_rateio),
      subtotal_itens: num(r.subtotal_itens),
      servico_valor: num(r.servico_valor),
      total: num(r.total),
      pago: num(r.pago),
      saldo: num(r.saldo),
    }));
  }

  private async pedidoAberto(pedidoId: number) {
    const p = await this.db.queryOne<any>(`SELECT * FROM pedido WHERE id = $1`, [pedidoId]);
    if (!p) throw new NotFoundException('Pedido não encontrado');
    if (p.status !== 'ABERTO') {
      throw new BadRequestException(`Pedido ${p.status.toLowerCase()} — conta não pode mudar`);
    }
    return p;
  }

  private async contaAberta(contaId: number) {
    const c = await this.db.queryOne<any>(`SELECT * FROM conta WHERE id = $1`, [contaId]);
    if (!c) throw new NotFoundException('Conta não encontrada');
    if (c.status !== 'ABERTA') {
      throw new BadRequestException(`Conta ${c.status.toLowerCase()} — não pode alterar`);
    }
    return c;
  }

  /** Conta que pode ser ALTERADA: aberta E de pedido aberto (pedido fechado = histórico). */
  private async contaEditavel(contaId: number) {
    const c = await this.contaAberta(contaId);
    await this.pedidoAberto(c.pedido_id);
    return c;
  }

  /** Trava a linha do pedido: serializa escritas concorrentes (pagamentos, divisões...). */
  private async lockPedido(q: (sql: string, params?: any[]) => Promise<any[]>, pedidoId: number) {
    await q(`SELECT id FROM pedido WHERE id = $1 FOR UPDATE`, [pedidoId]);
  }

  // ---------- escrita: contas ----------

  async criar(pedidoId: number, dto: CriarContaDto) {
    const pedido = await this.pedidoAberto(pedidoId);
    const cfg = await this.db.queryOne<any>(`SELECT * FROM config_restaurante WHERE id = 1`);
    const rows = await this.db.query<any>(
      `INSERT INTO conta (pedido_id, descricao, incluir_servico, servico_pct, desconto_valor, valor_rateio)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        pedidoId,
        dto.descricao ?? `Conta — Mesa ${pedido.mesa_id}`,
        dto.incluirServico ?? cfg?.gorjeta_incluir_por_padrao ?? true,
        dto.servicoPct ?? num(cfg?.gorjeta_percentual ?? 10),
        dto.descontoValor ?? 0,
        dto.valorRateio ?? null,
      ],
    );
    const conta = rows[0];
    this.ws.emitToRooms(
      [`mesa:${pedido.mesa_id}`, `pedido:${pedidoId}`, 'caixa'],
      'conta.criada',
      { pedidoId, mesaId: pedido.mesa_id, conta },
    );
    return this.detalhar(conta.id);
  }

  async atualizar(contaId: number, dto: AtualizarContaDto) {
    return this.db.transaction(async (q) => {
      const conta = await this.contaEditavel(contaId);
      await this.lockPedido(q, conta.pedido_id);
      if (dto.valorRateio !== undefined && dto.valorRateio !== null) {
        const n = await this.db.queryOne<any>(
          `SELECT COUNT(*)::int AS n FROM conta_item WHERE conta_id = $1`,
          [contaId],
        );
        if (Number(n?.n) > 0) {
          throw new BadRequestException('Conta com itens não pode virar rateio — remova os itens antes');
        }
      }
      const map: Record<string, any> = {
        descricao: dto.descricao,
        incluir_servico: dto.incluirServico,
        servico_pct: dto.servicoPct,
        desconto_valor: dto.descontoValor,
        valor_rateio: dto.valorRateio,
      };
      const sets: string[] = [];
      const params: any[] = [];
      for (const [col, v] of Object.entries(map)) {
        if (v !== undefined) {
          params.push(v);
          sets.push(`${col} = $${params.length}`);
        }
      }
      if (!sets.length) throw new BadRequestException('Nada para atualizar');
      // desconto/serviço/rateio nunca podem deixar o total ABAIXO do já pago
      // (senão o cliente pagaria a mais sem fluxo de devolução)
      if (
        dto.descontoValor !== undefined ||
        dto.incluirServico !== undefined ||
        dto.servicoPct !== undefined ||
        dto.valorRateio !== undefined
      ) {
        const r0 = await this.resumo(contaId);
        const subCents = conta.valor_rateio != null ? 0 : toCents(r0?.subtotal_itens);
        const novoRateio =
          dto.valorRateio !== undefined ? dto.valorRateio : num(conta.valor_rateio);
        // estado APÓS a mudança (null explícito remove o rateio)
        const ehRateio =
          dto.valorRateio !== undefined ? dto.valorRateio !== null : conta.valor_rateio != null;
        const novoDesc = toCents(
          dto.descontoValor !== undefined ? dto.descontoValor : num(conta.desconto_valor),
        );
        const novoIncluir =
          dto.incluirServico !== undefined ? dto.incluirServico : conta.incluir_servico;
        const novoPct = dto.servicoPct !== undefined ? dto.servicoPct : num(conta.servico_pct);
        let totalCents: number;
        if (ehRateio) {
          totalCents = toCents(novoRateio) - novoDesc;
        } else {
          const serv = novoIncluir ? Math.round((subCents * novoPct) / 100) : 0;
          totalCents = subCents + serv - novoDesc;
        }
        totalCents = Math.max(0, totalCents);
        const pagoCents = toCents(r0?.pago);
        if (totalCents < pagoCents) {
          throw new BadRequestException(
            `Ajuste deixaria o total (R$ ${br(toReais(totalCents))}) abaixo do já pago ` +
              `(R$ ${br(r0?.pago ?? 0)}) — estorne a diferença antes`,
          );
        }
      }
      params.push(contaId);
      await this.db.execute(
        `UPDATE conta SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      const det = await this.detalhar(contaId);
      this.ws.emitToRooms(
        [`mesa:${det.mesa_id}`, `pedido:${conta.pedido_id}`, 'caixa'],
        'conta.atualizada',
        { contaId, pedidoId: conta.pedido_id, mesaId: det.mesa_id, resumo: det.resumo },
      );
      return det;
    });
  }

  /** Cancela conta aberta sem pagamentos (libera as alocações p/ reuso). */
  async cancelar(contaId: number) {
    const conta = await this.contaEditavel(contaId);
    const pago = await this.db.queryOne<any>(
      `SELECT COALESCE(SUM(valor - valor_troco), 0) AS pago FROM pagamento
       WHERE conta_id = $1 AND status = 'APROVADO'`,
      [contaId],
    );
    if (toCents(pago?.pago) > 0) {
      throw new BadRequestException('Conta com pagamentos — estorne os pagamentos antes');
    }
    await this.db.transaction(async (q) => {
      await this.lockPedido(q, conta.pedido_id);
      await q(`DELETE FROM conta_item WHERE conta_id = $1`, [contaId]);
      await q(`UPDATE conta SET status = 'CANCELADA' WHERE id = $1`, [contaId]);
    });
    const pedido = await this.db.queryOne<any>(`SELECT mesa_id FROM pedido WHERE id = $1`, [conta.pedido_id]);
    this.ws.emitToRooms(
      [`mesa:${pedido.mesa_id}`, `pedido:${conta.pedido_id}`, 'caixa'],
      'conta.fechada',
      { contaId, pedidoId: conta.pedido_id, mesaId: pedido.mesa_id, status: 'CANCELADA' },
    );
    return { ok: true };
  }

  /** Fecha conta quitada (saldo zero). */
  async fechar(contaId: number) {
    return this.db.transaction(async (q) => {
      const conta = await this.contaEditavel(contaId);
      await this.lockPedido(q, conta.pedido_id);
      const r = await this.resumo(contaId);
      if (toCents(r?.saldo) < 0) {
        throw new BadRequestException(
          `Conta com pago ACIMA do total (R$ ${br(Math.abs(num(r.saldo)))}) — inconsistência: estorne a diferença`,
        );
      }
      if (toCents(r?.saldo) > 0) {
        throw new BadRequestException(`Conta com saldo em aberto de R$ ${br(r.saldo)}`);
      }
      await this.db.execute(`UPDATE conta SET status = 'FECHADA', fechada_em = now() WHERE id = $1`, [contaId]);
      const det = await this.detalhar(contaId);
      this.ws.emitToRooms(
        [`mesa:${det.mesa_id}`, `pedido:${conta.pedido_id}`, 'caixa'],
        'conta.fechada',
        { contaId, pedidoId: conta.pedido_id, mesaId: det.mesa_id, status: 'FECHADA' },
      );
      return det;
    });
  }

  // ---------- divisão por item ----------

  async alocarItem(contaId: number, dto: AlocarItemDto) {
    return this.db.transaction(async (q) => {
      const conta = await this.contaEditavel(contaId);
      await this.lockPedido(q, conta.pedido_id);
      if (conta.valor_rateio !== null && conta.valor_rateio !== undefined) {
        throw new BadRequestException('Conta de rateio (valor fixo) não recebe itens');
      }
      const item = await this.db.queryOne<any>(`SELECT * FROM pedido_item WHERE id = $1`, [dto.pedidoItemId]);
      if (!item || Number(item.pedido_id) !== Number(conta.pedido_id)) {
        throw new BadRequestException('Item não pertence ao pedido desta conta');
      }
      if (item.status === 'RASCUNHO') {
        throw new BadRequestException('Item ainda em rascunho — envie antes de lançar na conta');
      }
      if (item.status === 'CANCELADO') {
        throw new BadRequestException('Item cancelado não entra na conta');
      }
      const qtd = dto.quantidade ?? num(item.quantidade);
      try {
        const rows = await this.db.query(
          `INSERT INTO conta_item (conta_id, pedido_item_id, quantidade)
           VALUES ($1,$2,$3)
           ON CONFLICT (conta_id, pedido_item_id)
           DO UPDATE SET quantidade = conta_item.quantidade + EXCLUDED.quantidade
           RETURNING *`,
          [contaId, dto.pedidoItemId, qtd],
        );
        return rows[0];
      } catch (e: any) {
        // trigger tg_valida_rateio_itens (P0001) ou outros
        if (e?.code === 'P0001' || /Rateio excede/.test(e?.message || '')) {
          throw new BadRequestException('Quantidade excede o que foi pedido neste item');
        }
        throw e;
      }
    });
  }

  async removerAlocacao(contaId: number, contaItemId: number) {
    return this.db.transaction(async (q) => {
      const conta = await this.contaEditavel(contaId);
      await this.lockPedido(q, conta.pedido_id);
      // tirar item de conta com pagamento encolheria o total já pago
      const r = await this.resumo(contaId);
      if (toCents(r?.pago) > 0) {
        throw new BadRequestException(
          'Conta com pagamentos — estorne os pagamentos antes de mexer nos itens',
        );
      }
      const n = await this.db.execute(
        `DELETE FROM conta_item WHERE id = $1 AND conta_id = $2`,
        [contaItemId, contaId],
      );
      if (!n) throw new NotFoundException('Alocação não encontrada nesta conta');
      return { ok: true };
    });
  }

  /**
   * Aloca na conta todos os itens enviados ainda sem cobertura (atalho p/
   * "Nova conta" + rateios manuais). Somar itens nunca quebra o já pago
   * (só aumenta o saldo), então vale mesmo com pagamento parcial.
   */
  async alocarPendentes(contaId: number) {
    return this.db.transaction(async (q) => {
      const conta = await this.contaEditavel(contaId);
      await this.lockPedido(q, conta.pedido_id);
      if (conta.valor_rateio !== null && conta.valor_rateio !== undefined) {
        throw new BadRequestException('Conta de rateio (valor fixo) não recebe itens');
      }
      const sobras = await this.itensSemCobertura(conta.pedido_id);
      if (!sobras.length) throw new BadRequestException('Nada pendente — todos os itens já estão em contas');
      for (const e of sobras) {
        await this.alocarItem(contaId, { pedidoItemId: e.id, quantidade: e.restante });
      }
      return this.detalhar(contaId);
    });
  }

  // ---------- divisão igualitária ----------

  async dividirIgual(pedidoId: number, dto: DividirIgualDto) {
    const pedido = await this.pedidoAberto(pedidoId);
    if (dto.descricoes && dto.descricoes.length !== dto.partes) {
      throw new BadRequestException(`Informe ${dto.partes} descrições (ou nenhuma)`);
    }
    const rasc = await this.db.queryOne<any>(
      `SELECT COUNT(*)::int AS n FROM pedido_item WHERE pedido_id = $1 AND status = 'RASCUNHO'`,
      [pedidoId],
    );
    if (Number(rasc?.n) > 0) {
      throw new BadRequestException('Há itens em rascunho — envie ou remova antes de dividir');
    }
    return this.db.transaction(async (q) => {
      await this.lockPedido(q, pedidoId);
      const aloc = await q(
        `SELECT COUNT(*)::int AS n FROM conta_item ci JOIN conta c ON c.id = ci.conta_id
         WHERE c.pedido_id = $1 AND c.status = 'ABERTA'`,
        [pedidoId],
      );
      if (Number(aloc[0]?.n) > 0) {
        throw new BadRequestException('Já há divisão por item — cancele as contas antes de dividir igual');
      }
      const pagos = await q(
        `SELECT COUNT(*)::int AS n FROM pagamento pg JOIN conta c ON c.id = pg.conta_id
         WHERE c.pedido_id = $1 AND pg.status = 'APROVADO'`,
        [pedidoId],
      );
      if (Number(pagos[0]?.n) > 0) {
        throw new BadRequestException('Já há pagamentos — estorne antes de redividir');
      }
      // cancela contas abertas vazias (ex.: auto-criada pelo "imprimir conta")
      await q(
        `UPDATE conta SET status = 'CANCELADA' WHERE pedido_id = $1 AND status = 'ABERTA'
         AND valor_rateio IS NULL
         AND NOT EXISTS (SELECT 1 FROM conta_item ci WHERE ci.conta_id = conta.id)`,
        [pedidoId],
      );
      const base = await q(
        `SELECT COALESCE(SUM(quantidade * preco_unitario), 0) AS v FROM pedido_item
         WHERE pedido_id = $1 AND status NOT IN ('RASCUNHO','CANCELADO')`,
        [pedidoId],
      );
      const baseCents = toCents(base[0]?.v);
      if (baseCents <= 0) throw new BadRequestException('Pedido sem itens para dividir');
      const cfg = (await q(`SELECT * FROM config_restaurante WHERE id = 1`))[0];
      const incluir = dto.incluirServico ?? cfg?.gorjeta_incluir_por_padrao ?? true;
      const pct = num(cfg?.gorjeta_percentual ?? 10);
      const servCents = incluir ? Math.round((baseCents * pct) / 100) : 0;
      const total = baseCents + servCents;
      const cada = Math.floor(total / dto.partes);
      const contas: any[] = [];
      for (let i = 0; i < dto.partes; i++) {
        const valor = i === dto.partes - 1 ? total - cada * (dto.partes - 1) : cada;
        const rows = await q(
          `INSERT INTO conta (pedido_id, descricao, incluir_servico, servico_pct, valor_rateio)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [
            pedidoId,
            dto.descricoes?.[i] ?? `Parte ${i + 1}/${dto.partes}`,
            incluir,
            pct,
            toReais(valor),
          ],
        );
        contas.push(rows[0]);
      }
      return contas;
    }).then((contas) => {
      this.ws.emitToRooms(
        [`mesa:${pedido.mesa_id}`, `pedido:${pedidoId}`, 'caixa'],
        'conta.criada',
        { pedidoId, mesaId: pedido.mesa_id, contas, divisao: 'igualitaria' },
      );
      return contas;
    });
  }

  // ---------- "fecha a conta, por favor" ----------

  /** Itens enviados com quantidade ainda sem cobertura em conta válida. */
  private async itensSemCobertura(pedidoId: number): Promise<{ id: number; restante: number }[]> {
    const rows = await this.db.query<any>(
      `SELECT pi.id, pi.quantidade - COALESCE(
         (SELECT SUM(ci.quantidade) FROM conta_item ci
          JOIN conta c ON c.id = ci.conta_id
          WHERE ci.pedido_item_id = pi.id AND c.status <> 'CANCELADA'), 0) AS restante
       FROM pedido_item pi
       WHERE pi.pedido_id = $1 AND pi.status NOT IN ('RASCUNHO','CANCELADO')`,
      [pedidoId],
    );
    return rows
      .filter((e: any) => Number(e.restante) > 0.0005)
      .map((e: any) => ({ id: Number(e.id), restante: Number(e.restante) }));
  }

  /**
   * Garçom/caixa pede a conta: valida rascunhos, garante que todo item
   * enviado está em alguma conta (cria a conta única; se já houver UMA
   * aberta por item, soma as sobras nela; se a divisão é múltipla/rateio,
   * abre uma conta nova só com as sobras) e põe a mesa em AGUARDANDO_CONTA.
   */
  async imprimirConta(pedidoId: number) {
    return this.db.transaction(async (q) => {
      const pedido = await this.pedidoAberto(pedidoId);
      await this.lockPedido(q, pedidoId);
      const rasc = await this.db.queryOne<any>(
        `SELECT COUNT(*)::int AS n FROM pedido_item WHERE pedido_id = $1 AND status = 'RASCUNHO'`,
        [pedidoId],
      );
      if (Number(rasc?.n) > 0) {
        throw new BadRequestException(
          'Há itens em rascunho — envie para produção ou remova antes de pedir a conta',
        );
      }
      const mesa = await this.db.queryOne<any>(
        `SELECT numero FROM mesa WHERE id = $1`, [pedido.mesa_id],
      );
      const etiqueta = `Conta — Mesa ${mesa?.numero ?? pedido.mesa_id}`;
      let contas = await this.listarPorPedido(pedidoId);
      const abertas = () => contas.filter((c: any) => c.status === 'ABERTA');
      const sobras = await this.itensSemCobertura(pedidoId);
      if (!abertas().length) {
        if (!sobras.length) {
          throw new BadRequestException('Pedido sem itens para conta (tudo cancelado?)');
        }
        const nova = await this.criar(pedidoId, { descricao: etiqueta });
        for (const e of sobras) {
          await this.alocarItem(nova.id, { pedidoItemId: e.id, quantidade: e.restante });
        }
        contas = await this.listarPorPedido(pedidoId);
      } else if (sobras.length) {
        // itens lançados DEPOIS do primeiro "pedir conta": nunca somem —
        // conta única recebe as sobras; divisão múltipla ganha conta nova
        const unica = abertas().length === 1 ? abertas()[0] : null;
        const alvo =
          unica && unica.valor_rateio == null
            ? unica
            : await this.criar(pedidoId, { descricao: `${etiqueta} (itens após a conta)` });
        for (const e of sobras) {
          await this.alocarItem(alvo.id, { pedidoItemId: e.id, quantidade: e.restante });
        }
        contas = await this.listarPorPedido(pedidoId);
      }
      await this.db.execute(`UPDATE mesa SET status = 'AGUARDANDO_CONTA' WHERE id = $1`, [pedido.mesa_id]);
      this.ws.emitAll('mesa.status', {
        mesaId: pedido.mesa_id,
        status: 'AGUARDANDO_CONTA',
        pedidoId,
      });
      return { pedidoId, mesaId: pedido.mesa_id, contas };
    });
  }

  // ---------- pagamentos ----------

  private async resolverCaixa(caixaId?: number) {
    if (caixaId) {
      const cx = await this.db.queryOne<any>(`SELECT * FROM caixa WHERE id = $1`, [caixaId]);
      if (!cx) throw new NotFoundException('Caixa não encontrado');
      if (cx.status !== 'ABERTO') throw new BadRequestException('Caixa informado não está aberto');
      return cx;
    }
    const abertos = await this.db.query<any>(`SELECT * FROM caixa WHERE status = 'ABERTO' ORDER BY id`);
    if (!abertos.length) {
      throw new BadRequestException('Nenhum caixa aberto — abra o caixa antes de receber');
    }
    if (abertos.length > 1) {
      throw new BadRequestException('Mais de um caixa aberto — informe o caixaId');
    }
    return abertos[0];
  }

  async listarPagamentos(contaId: number) {
    const rows = await this.db.query<any>(
      `SELECT pg.*, u.nome AS operador_nome FROM pagamento pg
       LEFT JOIN caixa cx ON cx.id = pg.caixa_id
       LEFT JOIN usuario u ON u.id = cx.operador_id
       WHERE pg.conta_id = $1 ORDER BY pg.id`,
      [contaId],
    );
    return rows.map((r: any) => ({ ...r, valor: num(r.valor), valor_troco: num(r.valor_troco) }));
  }

  async criarPagamento(contaId: number, dto: CriarPagamentoDto) {
    return this.db.transaction(async (q) => {
      const conta = await this.contaEditavel(contaId);
      await this.lockPedido(q, conta.pedido_id);
      const trocoCents = toCents(dto.valorTroco ?? 0);
      const valorCents = toCents(dto.valor);
      if (trocoCents > 0 && dto.forma !== 'DINHEIRO') {
        throw new BadRequestException('Troco só faz sentido para pagamento em dinheiro');
      }
      const liquido = valorCents - trocoCents;
      if (liquido <= 0) {
        throw new BadRequestException('Valor líquido deve ser maior que zero');
      }
      const caixa = await this.resolverCaixa(dto.caixaId);
      const r = await this.resumo(contaId);
      const saldoCents = toCents(r?.saldo);
      if (liquido > saldoCents) {
        throw new BadRequestException(
          `Pagamento (R$ ${br(toReais(liquido))}) excede o saldo de R$ ${br(r?.saldo ?? 0)}`,
        );
      }
      const rows = await this.db.query<any>(
        `INSERT INTO pagamento (conta_id, caixa_id, forma, valor, valor_troco, referencia, observacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          contaId,
          caixa.id,
          dto.forma,
          toReais(valorCents),
          toReais(trocoCents),
          dto.referencia ?? null,
          dto.observacao ?? null,
        ],
      );
      const pagamento = rows[0];
      // quitou? fecha sozinho (comportamento padrão de PDV)
      const depois = await this.resumo(contaId);
      let fechada = false;
      if (toCents(depois?.saldo) <= 0) {
        await this.db.execute(`UPDATE conta SET status = 'FECHADA', fechada_em = now() WHERE id = $1`, [contaId]);
        fechada = true;
      }
      const det = await this.detalhar(contaId);
      this.ws.emitToRooms(
        [`mesa:${det.mesa_id}`, `pedido:${conta.pedido_id}`, 'caixa'],
        fechada ? 'conta.fechada' : 'conta.paga',
        {
          contaId,
          pedidoId: conta.pedido_id,
          mesaId: det.mesa_id,
          pagamento: { ...pagamento, valor: num(pagamento.valor), valor_troco: num(pagamento.valor_troco) },
          resumo: det.resumo,
          status: fechada ? 'FECHADA' : 'ABERTA',
        },
      );
      return det;
    });
  }

  /** Estorno: cancela pagamento aprovado; reabre a conta se voltar a ter saldo. */
  async cancelarPagamento(pagamentoId: number, dto: CancelarPagamentoDto, user?: { nome: string }) {
    return this.db.transaction(async (q) => {
      const pg = await this.db.queryOne<any>(`SELECT * FROM pagamento WHERE id = $1`, [pagamentoId]);
      if (!pg) throw new NotFoundException('Pagamento não encontrado');
      if (pg.status !== 'APROVADO') {
        throw new BadRequestException('Só pagamento aprovado pode ser estornado');
      }
      const conta = await this.db.queryOne<any>(`SELECT * FROM conta WHERE id = $1`, [pg.conta_id]);
      await this.lockPedido(q, conta.pedido_id);
      await this.pedidoAberto(conta.pedido_id);
      if (pg.caixa_id) {
        const cx = await this.db.queryOne<any>(`SELECT status FROM caixa WHERE id = $1`, [pg.caixa_id]);
        if (!cx || cx.status !== 'ABERTO') {
          throw new BadRequestException(
            'Pagamento é de um caixa já fechado — estornar alteraria uma conferência passada',
          );
        }
      }
      const obs = [pg.observacao, `ESTORNO${user?.nome ? ` por ${user.nome}` : ''}${dto.motivo ? `: ${dto.motivo}` : ''}`]
        .filter(Boolean)
        .join(' | ');
      await this.db.execute(
        `UPDATE pagamento SET status = 'CANCELADO', observacao = $1 WHERE id = $2`,
        [obs, pagamentoId],
      );
      let reaberta = false;
      if (conta.status === 'FECHADA') {
        const r = await this.resumo(conta.id);
        if (toCents(r?.saldo) > 0) {
          await this.db.execute(`UPDATE conta SET status = 'ABERTA', fechada_em = NULL WHERE id = $1`, [conta.id]);
          reaberta = true;
        }
      }
      const det = await this.detalhar(conta.id);
      this.ws.emitToRooms(
        [`mesa:${det.mesa_id}`, `pedido:${conta.pedido_id}`, 'caixa'],
        'conta.paga',
        { contaId: conta.id, pedidoId: conta.pedido_id, mesaId: det.mesa_id, estorno: pagamentoId, reaberta, resumo: det.resumo },
      );
      return det;
    });
  }

  // ---------- fechar pedido (libera a mesa) ----------

  async fecharPedido(pedidoId: number) {
    return this.db.transaction(async (q) => {
      const pedido = await this.pedidoAberto(pedidoId);
      await this.lockPedido(q, pedidoId);
      const pend = await this.db.query<any>(
        `SELECT status, COUNT(*)::int AS n FROM pedido_item
         WHERE pedido_id = $1 AND status NOT IN ('ENTREGUE','CANCELADO')
         GROUP BY status`,
        [pedidoId],
      );
      if (pend.length) {
        const desc = pend.map((p: any) => `${p.n}x ${p.status}`).join(', ');
        throw new BadRequestException(
          `Pedido tem itens pendentes (${desc}) — entregue/cancele tudo antes de fechar`,
        );
      }
      const contas = await this.db.query<any>(`SELECT * FROM conta WHERE pedido_id = $1`, [pedidoId]);
      if (!contas.length) {
        throw new BadRequestException('Pedido sem conta — crie e quite a conta antes de fechar');
      }
      const abertas = contas.filter((c: any) => c.status === 'ABERTA');
      if (abertas.length) {
        const saldos = await Promise.all(abertas.map((c: any) => this.resumo(c.id)));
        const total = saldos.reduce((s: number, r: any) => s + toCents(r?.saldo), 0);
        throw new BadRequestException(
          `${abertas.length} conta(s) em aberto (saldo R$ ${br(toReais(total))}) — quite antes de fechar`,
        );
      }
      // furo de caixa: item ENTREGUE sem cobertura em nenhuma conta válida
      // (ex.: todas as contas por item canceladas). Rateio assume o pedido
      // por valor fechado — nesse caso a responsabilidade é do operador.
      const desc = await this.db.queryOne<any>(
        `SELECT COUNT(*)::int AS n FROM pedido_item pi
         WHERE pi.pedido_id = $1 AND pi.status = 'ENTREGUE'
           AND COALESCE((SELECT SUM(ci.quantidade) FROM conta_item ci
                         JOIN conta c ON c.id = ci.conta_id
                         WHERE ci.pedido_item_id = pi.id AND c.status <> 'CANCELADA'), 0) < pi.quantidade`,
        [pedidoId],
      );
      if (Number(desc?.n) > 0) {
        const rateio = await this.db.queryOne<any>(
          `SELECT COUNT(*)::int AS n FROM conta
           WHERE pedido_id = $1 AND status <> 'CANCELADA' AND valor_rateio IS NOT NULL`,
          [pedidoId],
        );
        if (Number(rateio?.n) === 0) {
          throw new BadRequestException(
            `${desc.n} item(ns) entregue(s) sem conta cobrindo — aloque os itens ` +
              `ou faça a divisão igualitária antes de fechar`,
          );
        }
      }
      await this.db.execute(`UPDATE pedido SET status = 'FECHADO', fechado_em = now() WHERE id = $1`, [pedidoId]);
      this.ws.emitAll('pedido.fechado', { pedidoId, mesaId: pedido.mesa_id });
      this.ws.emitAll('mesa.status', { mesaId: pedido.mesa_id, status: 'LIVRE', pedidoId });
      return { ok: true, pedidoId, mesaId: pedido.mesa_id };
    });
  }

  // ---------- recibo (texto p/ imprimir no caixa/navegador) ----------

  async recibo(contaId: number): Promise<{ texto: string }> {
    const det = await this.detalhar(contaId);
    const cfg = await this.db.queryOne<any>(`SELECT nome FROM config_restaurante WHERE id = 1`);
    const ped = await this.db.queryOne<any>(
      `SELECT p.id, p.aberto_em, u.nome AS garcom FROM pedido p
       LEFT JOIN usuario u ON u.id = p.garcom_id WHERE p.id = $1`,
      [det.pedido_id],
    );
    const W = 42;
    const L: string[] = [];
    const c = (s: string) => {
      const t = s.slice(0, W);
      L.push(' '.repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t);
    };
    const row = (l: string, v: string) => {
      const left = l.slice(0, W - v.length - 1);
      L.push(left + ' '.repeat(Math.max(1, W - left.length - v.length)) + v);
    };
    c((cfg?.nome || 'Restaurante').toUpperCase());
    c(`CONTA - MESA ${det.mesa_numero}`);
    L.push(`${det.descricao} - Pedido #${det.pedido_id}`.slice(0, W));
    if (ped?.garcom) L.push(`Garcom: ${ped.garcom}`.slice(0, W));
    L.push('-'.repeat(W));
    if (det.valor_rateio != null) {
      row(`Rateio (${det.descricao})`.slice(0, 28), br(det.valor_rateio));
    } else if (!det.itens.length) {
      L.push('(sem itens)');
    } else {
      for (const i of det.itens) {
        row(`${i.quantidade}x ${i.produto}`.slice(0, 30), br(num(i.quantidade) * num(i.preco_unitario)));
      }
    }
    L.push('-'.repeat(W));
    row('Subtotal', br(det.resumo?.subtotal_itens ?? 0));
    if (num(det.resumo?.servico_valor) > 0) {
      row(`Servico (${num(det.servico_pct)}%)`, br(det.resumo.servico_valor));
    }
    if (num(det.desconto_valor) > 0) row('Desconto', br(det.desconto_valor));
    row('TOTAL', br(det.resumo?.total ?? 0));
    row('Pago', br(det.resumo?.pago ?? 0));
    row('SALDO', br(det.resumo?.saldo ?? 0));
    L.push('-'.repeat(W));
    if (det.pagamentos.length) {
      for (const p of det.pagamentos.filter((x: any) => x.status === 'APROVADO')) {
        row(p.forma.replace(/_/g, ' '), br(p.valor));
      }
      L.push('-'.repeat(W));
    }
    c('Obrigado! Volte sempre :)');
    c(new Date().toLocaleString('pt-BR'));
    return { texto: L.join('\n') };
  }
}
