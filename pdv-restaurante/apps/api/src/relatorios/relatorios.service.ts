import { BadRequestException, Injectable } from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';

const round2 = (v: number) => Math.round(v * 100) / 100;

@Injectable()
export class RelatoriosService {
  constructor(private readonly db: DbService) {}

  /** Período padrão = mês corrente até hoje; `ate` inclusivo (vira exclusivo +1 dia). */
  private periodo(de?: string, ate?: string): { ini: string; fim: string; fimExcl: string } {
    const hoje = new Date().toISOString().slice(0, 10);
    const fim = ate ?? hoje;
    const ini = de ?? `${fim.slice(0, 7)}-01`;
    if (isNaN(Date.parse(ini)) || isNaN(Date.parse(fim))) {
      throw new BadRequestException('Período inválido (use AAAA-MM-DD)');
    }
    if (ini > fim) throw new BadRequestException('de deve ser anterior ou igual a ate');
    const d = new Date(`${fim}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return { ini, fim, fimExcl: d.toISOString().slice(0, 10) };
  }

  /**
   * Vendas: RECEBIDO (pagamentos aprovados no período) por forma e por dia,
   * pedidos fechados, ticket médio, descontos e serviço das contas do período.
   */
  async vendas(de?: string, ate?: string) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const formas = await this.db.query<any>(
      `SELECT pg.forma, COUNT(*)::int AS n,
              COALESCE(SUM(pg.valor - pg.valor_troco), 0) AS valor
       FROM pagamento pg
       WHERE pg.status = 'APROVADO' AND pg.pago_em >= $1 AND pg.pago_em < $2
       GROUP BY pg.forma ORDER BY valor DESC`,
      [ini, fimExcl],
    );
    const dias = await this.db.query<any>(
      `SELECT pg.pago_em::date AS dia, COUNT(*)::int AS n,
              COALESCE(SUM(pg.valor - pg.valor_troco), 0) AS valor
       FROM pagamento pg
       WHERE pg.status = 'APROVADO' AND pg.pago_em >= $1 AND pg.pago_em < $2
       GROUP BY 1 ORDER BY 1`,
      [ini, fimExcl],
    );
    const ped = await this.db.queryOne<any>(
      `SELECT COUNT(*)::int AS n FROM pedido
       WHERE status = 'FECHADO' AND fechado_em >= $1 AND fechado_em < $2`,
      [ini, fimExcl],
    );
    const extra = await this.db.queryOne<any>(
      `SELECT COALESCE(SUM(c.desconto_valor), 0) AS descontos,
              COALESCE(SUM(r.servico_valor), 0) AS servico
       FROM conta c JOIN pedido p ON p.id = c.pedido_id
       LEFT JOIN vw_conta_resumo r ON r.conta_id = c.id
       WHERE p.status = 'FECHADO' AND p.fechado_em >= $1 AND p.fechado_em < $2
         AND c.status <> 'CANCELADA'`,
      [ini, fimExcl],
    );
    const recebido = round2(formas.reduce((s: number, f: any) => s + num(f.valor), 0));
    const nPedidos = Number(ped?.n ?? 0);
    return {
      de: ini,
      ate: fim,
      recebido_total: recebido,
      n_pagamentos: formas.reduce((s: number, f: any) => s + Number(f.n), 0),
      pedidos_fechados: nPedidos,
      ticket_medio: nPedidos > 0 ? round2(recebido / nPedidos) : null,
      descontos_total: round2(num(extra?.descontos)),
      servico_total: round2(num(extra?.servico)),
      por_forma: formas.map((f: any) => ({ forma: f.forma, n: Number(f.n), valor: round2(num(f.valor)) })),
      por_dia: dias.map((x: any) => ({
        dia: x.dia instanceof Date ? x.dia.toISOString().slice(0, 10) : String(x.dia).slice(0, 10),
        n: Number(x.n),
        valor: round2(num(x.valor)),
      })),
    };
  }

  /**
   * Curva ABC de produtos sobre itens vendidos (pedidos FECHADOS no período,
   * sem cancelados): receita bruta dos itens, CMV das baixas e classe A/B/C.
   */
  async produtos(de?: string, ate?: string, limite = 50) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const rows = await this.db.query<any>(
      `SELECT pr.id AS produto_id, pr.nome AS produto, cat.nome AS categoria,
              COALESCE(SUM(pi.quantidade), 0) AS qtd,
              COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0) AS receita,
              (SELECT COALESCE(SUM(m.quantidade * COALESCE(m.custo_unitario, 0)), 0)
               FROM estoque_movimento m JOIN pedido_item pi2 ON pi2.id = m.pedido_item_id
               WHERE pi2.produto_id = pr.id AND pi2.status <> 'CANCELADO'
                 AND m.tipo = 'SAIDA_VENDA'
                 AND pi2.pedido_id IN (SELECT p.id FROM pedido p
                                       WHERE p.status = 'FECHADO'
                                         AND p.fechado_em >= $1 AND p.fechado_em < $2)) AS cmv
       FROM pedido_item pi
       JOIN pedido p ON p.id = pi.pedido_id
       JOIN produto pr ON pr.id = pi.produto_id
       JOIN categoria cat ON cat.id = pr.categoria_id
       WHERE p.status = 'FECHADO' AND p.fechado_em >= $1 AND p.fechado_em < $2
         AND pi.status <> 'CANCELADO'
       GROUP BY pr.id, pr.nome, cat.nome
       ORDER BY receita DESC
       LIMIT ${Math.min(Math.max(limite, 1), 200)}`,
      [ini, fimExcl],
    );
    const total = rows.reduce((s: number, r: any) => s + num(r.receita), 0);
    let acum = 0;
    const itens = rows.map((r: any) => {
      const receita = round2(num(r.receita));
      const pct = total > 0 ? round2((receita / total) * 100) : 0;
      acum = round2(acum + pct);
      const cmv = round2(num(r.cmv));
      return {
        produto_id: Number(r.produto_id),
        produto: r.produto,
        categoria: r.categoria,
        qtd: num(r.qtd),
        receita,
        receita_pct: pct,
        receita_acumulada_pct: acum,
        classe: acum <= 80 ? 'A' : acum <= 95 ? 'B' : 'C',
        cmv,
        margem_bruta: round2(receita - cmv),
        margem_pct: receita > 0 ? round2(((receita - cmv) / receita) * 100) : null,
      };
    });
    return { de: ini, ate: fim, receita_total: round2(total), itens };
  }

  /** Receita bruta dos itens por categoria (mesma base da curva ABC). */
  async categorias(de?: string, ate?: string) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const rows = await this.db.query<any>(
      `SELECT cat.nome AS categoria,
              COALESCE(SUM(pi.quantidade), 0) AS qtd,
              COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0) AS receita
       FROM pedido_item pi
       JOIN pedido p ON p.id = pi.pedido_id
       JOIN produto pr ON pr.id = pi.produto_id
       JOIN categoria cat ON cat.id = pr.categoria_id
       WHERE p.status = 'FECHADO' AND p.fechado_em >= $1 AND p.fechado_em < $2
         AND pi.status <> 'CANCELADO'
       GROUP BY cat.nome ORDER BY receita DESC`,
      [ini, fimExcl],
    );
    const total = rows.reduce((s: number, r: any) => s + num(r.receita), 0);
    return {
      de: ini,
      ate: fim,
      receita_total: round2(total),
      itens: rows.map((r: any) => ({
        categoria: r.categoria,
        qtd: num(r.qtd),
        receita: round2(num(r.receita)),
        receita_pct: total > 0 ? round2((num(r.receita) / total) * 100) : 0,
      })),
    };
  }

  /** Por garçom: pedidos fechados, receita dos itens, ticket e serviço gerado. */
  async garcons(de?: string, ate?: string) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const rows = await this.db.query<any>(
      `SELECT u.id AS garcom_id, u.nome AS garcom,
              COUNT(DISTINCT p.id)::int AS pedidos,
              COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0) AS receita
       FROM pedido p JOIN usuario u ON u.id = p.garcom_id
       LEFT JOIN pedido_item pi ON pi.pedido_id = p.id AND pi.status <> 'CANCELADO'
       WHERE p.status = 'FECHADO' AND p.fechado_em >= $1 AND p.fechado_em < $2
       GROUP BY u.id, u.nome ORDER BY receita DESC`,
      [ini, fimExcl],
    );
    const serv = await this.db.query<any>(
      `SELECT p.garcom_id, COALESCE(SUM(r.servico_valor), 0) AS servico
       FROM conta c JOIN pedido p ON p.id = c.pedido_id
       LEFT JOIN vw_conta_resumo r ON r.conta_id = c.id
       WHERE p.status = 'FECHADO' AND p.fechado_em >= $1 AND p.fechado_em < $2
         AND c.status <> 'CANCELADA'
       GROUP BY p.garcom_id`,
      [ini, fimExcl],
    );
    const smap = new Map<number, number>(serv.map((x: any) => [Number(x.garcom_id), num(x.servico)]));
    return {
      de: ini,
      ate: fim,
      itens: rows.map((r: any) => {
        const receita = round2(num(r.receita));
        const pedidos = Number(r.pedidos);
        return {
          garcom_id: Number(r.garcom_id),
          garcom: r.garcom,
          pedidos_fechados: pedidos,
          receita_itens: receita,
          ticket_medio: pedidos > 0 ? round2(receita / pedidos) : null,
          servico_gerado: round2(smap.get(Number(r.garcom_id)) ?? 0),
        };
      }),
    };
  }

  /** Giro de mesas: ocupações, tempo médio e receita por mesa. */
  async mesas(de?: string, ate?: string) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const rows = await this.db.query<any>(
      `SELECT m.numero AS mesa, a.nome AS area, COUNT(*)::int AS ocupacoes,
              AVG(EXTRACT(EPOCH FROM (x.fechado_em - x.aberto_em)) / 60) AS tempo_medio_min,
              COALESCE(SUM(x.receita), 0) AS receita
       FROM (SELECT p.mesa_id, p.aberto_em, p.fechado_em,
                    (SELECT COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0)
                     FROM pedido_item pi
                     WHERE pi.pedido_id = p.id AND pi.status <> 'CANCELADO') AS receita
             FROM pedido p
             WHERE p.status = 'FECHADO' AND p.fechado_em >= $1 AND p.fechado_em < $2) x
       JOIN mesa m ON m.id = x.mesa_id JOIN area a ON a.id = m.area_id
       GROUP BY m.numero, a.nome ORDER BY receita DESC`,
      [ini, fimExcl],
    );
    return {
      de: ini,
      ate: fim,
      itens: rows.map((r: any) => ({
        mesa: Number(r.mesa),
        area: r.area,
        ocupacoes: Number(r.ocupacoes),
        tempo_medio_min: r.tempo_medio_min == null ? null : Math.round(num(r.tempo_medio_min)),
        receita_itens: round2(num(r.receita)),
      })),
    };
  }

  /** Turnos de caixa iniciados no período: vendido, sangrias/suprimentos, diferença. */
  async caixas(de?: string, ate?: string) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const rows = await this.db.query<any>(
      `SELECT cx.id, u.nome AS operador, cx.status, cx.aberto_em, cx.fechado_em,
              (SELECT COALESCE(SUM(pg.valor - pg.valor_troco), 0) FROM pagamento pg
               WHERE pg.caixa_id = cx.id AND pg.status = 'APROVADO') AS vendido,
              (SELECT COALESCE(SUM(k.valor), 0) FROM caixa_movimento k
               WHERE k.caixa_id = cx.id AND k.tipo = 'SUPRIMENTO') AS suprimentos,
              (SELECT COALESCE(SUM(k.valor), 0) FROM caixa_movimento k
               WHERE k.caixa_id = cx.id AND k.tipo = 'SANGRIA') AS sangrias,
              cx.diferenca
       FROM caixa cx JOIN usuario u ON u.id = cx.operador_id
       WHERE cx.aberto_em >= $1 AND cx.aberto_em < $2
       ORDER BY cx.id`,
      [ini, fimExcl],
    );
    return {
      de: ini,
      ate: fim,
      itens: rows.map((r: any) => ({
        caixa_id: Number(r.id),
        operador: r.operador,
        status: r.status,
        aberto_em: r.aberto_em,
        fechado_em: r.fechado_em,
        vendido: round2(num(r.vendido)),
        suprimentos: round2(num(r.suprimentos)),
        sangrias: round2(num(r.sangrias)),
        diferenca: r.diferenca == null ? null : round2(num(r.diferenca)),
      })),
    };
  }
}
