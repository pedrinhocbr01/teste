import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import {
  AtualizarInsumoDto,
  ContagemDto,
  CriarInsumoDto,
  CriarInventarioDto,
  CriarMovimentoDto,
  ReceberCompraDto,
} from './dto';

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

@Injectable()
export class EstoqueService {
  constructor(private readonly db: DbService) {}

  async saldos() {
    const rows = await this.db.query<any>(`SELECT * FROM vw_saldo_insumo ORDER BY nome`);
    return rows.map((r) => ({ ...r, saldo: num(r.saldo) }));
  }

  async alertas(somenteAlerta = true) {
    const rows = await this.db.query<any>(
      `SELECT * FROM vw_alerta_estoque ${somenteAlerta ? `WHERE nivel <> 'OK'` : ''} ORDER BY
        CASE nivel WHEN 'SEM_SALDO' THEN 0 WHEN 'ABAIXO_DO_MINIMO' THEN 1 WHEN 'COMPRA_URGENTE' THEN 2 ELSE 3 END, nome`,
    );
    return rows.map((r) => ({
      ...r,
      saldo: num(r.saldo),
      estoque_minimo: num(r.estoque_minimo),
      consumo_30d: r.consumo_30d == null ? null : num(r.consumo_30d),
      dias_de_estoque: r.dias_de_estoque == null ? null : num(r.dias_de_estoque),
      compra_sugerida: num(r.compra_sugerida),
    }));
  }

  async listarInsumos(q?: string) {
    const rows = await this.db.query<any>(
      `SELECT i.*, um.sigla AS unidade, uc.sigla AS unidade_compra,
              COALESCE((SELECT s.saldo FROM vw_saldo_insumo s WHERE s.insumo_id = i.id), 0) AS saldo,
              f.nome AS fornecedor
       FROM insumo i
       JOIN unidade_medida um ON um.id = i.unidade_estoque_id
       LEFT JOIN unidade_medida uc ON uc.id = i.unidade_compra_id
       LEFT JOIN fornecedor f ON f.id = i.fornecedor_padrao_id
       ${q ? 'WHERE i.nome ILIKE $1' : ''}
       ORDER BY i.nome`,
      q ? [`%${q}%`] : [],
    );
    return rows.map((r) => ({
      ...r,
      custo_unitario: num(r.custo_unitario),
      estoque_minimo: num(r.estoque_minimo),
      estoque_maximo: r.estoque_maximo == null ? null : num(r.estoque_maximo),
      fator_compra: num(r.fator_compra),
      saldo: num(r.saldo),
    }));
  }

  async detalharInsumo(id: number) {
    const insumo = await this.db.queryOne<any>(
      `SELECT i.*, um.sigla AS unidade,
              COALESCE((SELECT s.saldo FROM vw_saldo_insumo s WHERE s.insumo_id = i.id), 0) AS saldo
       FROM insumo i JOIN unidade_medida um ON um.id = i.unidade_estoque_id
       WHERE i.id = $1`,
      [id],
    );
    if (!insumo) throw new NotFoundException('Insumo não encontrado');
    const movimentos = await this.db.query<any>(
      `SELECT m.*, u.nome AS usuario_nome FROM estoque_movimento m
       LEFT JOIN usuario u ON u.id = m.usuario_id
       WHERE m.insumo_id = $1 ORDER BY m.data_movimento DESC LIMIT 30`,
      [id],
    );
    return {
      ...insumo,
      saldo: num(insumo.saldo),
      movimentos: movimentos.map((m) => ({
        ...m,
        quantidade: num(m.quantidade),
        custo_unitario: m.custo_unitario == null ? null : num(m.custo_unitario),
      })),
    };
  }

  async criarInsumo(dto: CriarInsumoDto) {
    try {
      const rows = await this.db.query(
        `INSERT INTO insumo (nome, unidade_estoque_id, unidade_compra_id, fator_compra,
           custo_unitario, estoque_minimo, estoque_maximo, fornecedor_padrao_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          dto.nome,
          dto.unidadeEstoqueId,
          dto.unidadeCompraId ?? null,
          dto.fatorCompra ?? 1,
          dto.custoUnitario ?? 0,
          dto.estoqueMinimo ?? 0,
          dto.estoqueMaximo ?? null,
          dto.fornecedorPadraoId ?? null,
        ],
      );
      return rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Insumo já existe');
      if (e?.code === '23503') throw new BadRequestException('Unidade/fornecedor inválido');
      throw e;
    }
  }

  async atualizarInsumo(id: number, dto: AtualizarInsumoDto) {
    const map: Record<string, any> = {
      nome: dto.nome,
      custo_unitario: dto.custoUnitario,
      estoque_minimo: dto.estoqueMinimo,
      estoque_maximo: dto.estoqueMaximo,
      fornecedor_padrao_id: dto.fornecedorPadraoId,
      ativo: dto.ativo,
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
    params.push(id);
    let row: any;
    try {
      row = await this.db.queryOne(
        `UPDATE insumo SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Insumo já existe');
      if (e?.code === '23503') throw new BadRequestException('Fornecedor inválido');
      throw e;
    }
    if (!row) throw new NotFoundException('Insumo não encontrado');
    return row;
  }

  async lancarMovimento(dto: CriarMovimentoDto, usuarioId: number) {
    const insumo = await this.db.queryOne(`SELECT id FROM insumo WHERE id = $1`, [dto.insumoId]);
    if (!insumo) throw new NotFoundException('Insumo não encontrado');
    const origem =
      dto.tipo === 'ENTRADA' ? 'COMPRA_FORNECEDOR' : dto.tipo.startsWith('AJUSTE') ? 'CONTAGEM' : 'OUTRO';
    const rows = await this.db.query(
      `INSERT INTO estoque_movimento (insumo_id, tipo, quantidade, custo_unitario, origem, usuario_id, motivo)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        dto.insumoId,
        dto.tipo,
        dto.quantidade,
        dto.custoUnitario ?? null,
        origem,
        usuarioId,
        dto.motivo ?? null,
      ],
    );
    return rows[0];
  }

  listarMovimentos(insumoId?: number) {
    return this.db.query(
      `SELECT m.*, i.nome AS insumo_nome, u.nome AS usuario_nome
       FROM estoque_movimento m
       JOIN insumo i ON i.id = m.insumo_id
       LEFT JOIN usuario u ON u.id = m.usuario_id
       ${insumoId ? 'WHERE m.insumo_id = $1' : ''}
       ORDER BY m.data_movimento DESC LIMIT 100`,
      insumoId ? [insumoId] : [],
    );
  }

  listarUnidades() {
    return this.db.query(`SELECT * FROM unidade_medida ORDER BY sigla`);
  }

  listarFornecedores() {
    return this.db.query(`SELECT * FROM fornecedor WHERE ativo ORDER BY nome`);
  }

  // ---------- FASE 4: recebimento de compra ----------

  /**
   * Recebimento de compra: converte unidade de compra → estoque (fator),
   * lança ENTRADA e atualiza o custo pelo MÉDIO PONDERADO
   * (saldo×custo + entrada×custo) / (saldo + entrada). Sem custoTotal, o
   * custo não muda. Tudo atômico (uma nota = uma transação).
   */
  async receberCompra(dto: ReceberCompraDto, usuarioId: number) {
    let fornNome: string | null = null;
    if (dto.fornecedorId) {
      const f = await this.db.queryOne<any>(
        `SELECT nome FROM fornecedor WHERE id = $1 AND ativo`,
        [dto.fornecedorId],
      );
      if (!f) throw new BadRequestException('Fornecedor inválido');
      fornNome = f.nome;
    }
    const insumos = new Map<number, any>();
    for (const it of dto.itens) {
      if (insumos.has(it.insumoId)) {
        throw new BadRequestException(
          `Insumo ${it.insumoId} repetido na nota — some as quantidades`,
        );
      }
      const ins = await this.db.queryOne<any>(
        `SELECT i.*, um.sigla AS unidade, uc.sigla AS unidade_compra
         FROM insumo i
         JOIN unidade_medida um ON um.id = i.unidade_estoque_id
         LEFT JOIN unidade_medida uc ON uc.id = i.unidade_compra_id
         WHERE i.id = $1`,
        [it.insumoId],
      );
      if (!ins) throw new NotFoundException(`Insumo ${it.insumoId} não encontrado`);
      insumos.set(it.insumoId, ins);
    }
    const motivo = [dto.documento, fornNome, dto.observacao].filter(Boolean).join(' — ') || 'Compra';
    return this.db.transaction(async (q) => {
      const linhas: any[] = [];
      for (const it of dto.itens) {
        const ins = insumos.get(it.insumoId);
        const fator = num(ins.fator_compra) || 1;
        const emCompra = ins.unidade_compra_id != null;
        const qtdEstoque = round3(it.quantidade * (emCompra ? fator : 1));
        if (qtdEstoque <= 0) {
          throw new BadRequestException(`Quantidade inválida p/ ${ins.nome}`);
        }
        const saldoRow = await q(`SELECT saldo FROM vw_saldo_insumo WHERE insumo_id = $1`, [it.insumoId]);
        const saldo = num(saldoRow[0]?.saldo);
        const custoAtual = num(ins.custo_unitario);
        let custoLinha: number | null = null;
        let custoNovo = custoAtual;
        if (it.custoTotal !== undefined) {
          custoLinha = round4(it.custoTotal / qtdEstoque);
          custoNovo =
            saldo > 0
              ? round4((saldo * custoAtual + qtdEstoque * custoLinha) / (saldo + qtdEstoque))
              : custoLinha;
          await q(`UPDATE insumo SET custo_unitario = $1 WHERE id = $2`, [custoNovo, it.insumoId]);
        }
        await q(
          `INSERT INTO estoque_movimento (insumo_id, tipo, quantidade, custo_unitario, origem, usuario_id, motivo)
           VALUES ($1,'ENTRADA',$2,$3,'COMPRA_FORNECEDOR',$4,$5)`,
          [it.insumoId, qtdEstoque, custoLinha ?? custoAtual, usuarioId, motivo],
        );
        linhas.push({
          insumo_id: it.insumoId,
          insumo: ins.nome,
          unidade: ins.unidade,
          unidade_compra: emCompra ? ins.unidade_compra : null,
          quantidade_compra: emCompra ? it.quantidade : null,
          quantidade_estoque: qtdEstoque,
          custo_linha: custoLinha,
          custo_medio_anterior: custoAtual,
          custo_medio_novo: custoNovo,
          saldo_novo: round3(saldo + qtdEstoque),
        });
      }
      return { documento: dto.documento ?? null, fornecedor: fornNome, motivo, linhas };
    });
  }

  // ---------- FASE 4: inventário ----------

  listarInventarios() {
    return this.db.query(
      `SELECT i.*, u.nome AS usuario_nome,
              (SELECT COUNT(*)::int FROM inventario_contagem c WHERE c.inventario_id = i.id) AS n_contagens
       FROM inventario i LEFT JOIN usuario u ON u.id = i.usuario_id
       ORDER BY i.id DESC LIMIT 50`,
    );
  }

  private async inventarioAberto(id: number) {
    const inv = await this.db.queryOne<any>(`SELECT * FROM inventario WHERE id = $1`, [id]);
    if (!inv) throw new NotFoundException('Inventário não encontrado');
    if (inv.status !== 'ABERTO') {
      throw new BadRequestException(`Inventário ${inv.status.toLowerCase()} — não pode alterar`);
    }
    return inv;
  }

  async criarInventario(dto: CriarInventarioDto, usuarioId: number) {
    const aberto = await this.db.queryOne<any>(
      `SELECT id, descricao FROM inventario WHERE status = 'ABERTO' ORDER BY id LIMIT 1`,
    );
    if (aberto) {
      throw new ConflictException(
        `Já existe o inventário #${aberto.id} aberto — feche ou cancele antes de abrir outro`,
      );
    }
    const rows = await this.db.query(
      `INSERT INTO inventario (descricao, usuario_id) VALUES ($1,$2) RETURNING *`,
      [dto.descricao ?? 'Inventário', usuarioId],
    );
    return rows[0];
  }

  async detalharInventario(id: number) {
    const inv = await this.db.queryOne<any>(
      `SELECT i.*, u.nome AS usuario_nome FROM inventario i
       LEFT JOIN usuario u ON u.id = i.usuario_id WHERE i.id = $1`,
      [id],
    );
    if (!inv) throw new NotFoundException('Inventário não encontrado');
    const linhas = await this.db.query<any>(
      `SELECT c.insumo_id, i.nome AS insumo, um.sigla AS unidade,
              c.quantidade AS contado, c.contado_em,
              i.custo_unitario,
              COALESCE((SELECT s.saldo FROM vw_saldo_insumo s WHERE s.insumo_id = c.insumo_id), 0) AS sistema
       FROM inventario_contagem c
       JOIN insumo i ON i.id = c.insumo_id
       JOIN unidade_medida um ON um.id = i.unidade_estoque_id
       WHERE c.inventario_id = $1 ORDER BY i.nome`,
      [id],
    );
    let valorAjustes = 0;
    const itens = linhas.map((l: any) => {
      const contado = num(l.contado);
      const sistema = num(l.sistema);
      const diferenca = round3(contado - sistema);
      const custo = num(l.custo_unitario);
      const valor = Math.round(diferenca * custo * 100) / 100;
      valorAjustes = Math.round((valorAjustes + valor) * 100) / 100;
      return {
        insumo_id: l.insumo_id,
        insumo: l.insumo,
        unidade: l.unidade,
        contado,
        sistema,
        diferenca,
        custo_unitario: custo,
        valor_diferenca: valor,
        contado_em: l.contado_em,
      };
    });
    return {
      ...inv,
      itens,
      resumo: {
        n_itens: itens.length,
        n_sobra: itens.filter((x: any) => x.diferenca > 0).length,
        n_falta: itens.filter((x: any) => x.diferenca < 0).length,
        valor_ajustes: valorAjustes,
      },
    };
  }

  /** Lança (ou corrige) a contagem de um insumo — upsert por (inventário, insumo). */
  async lancarContagem(id: number, dto: ContagemDto) {
    await this.inventarioAberto(id);
    const ins = await this.db.queryOne(`SELECT id FROM insumo WHERE id = $1`, [dto.insumoId]);
    if (!ins) throw new NotFoundException('Insumo não encontrado');
    const outro = await this.db.queryOne<any>(
      `SELECT c.inventario_id FROM inventario_contagem c
       JOIN inventario i ON i.id = c.inventario_id
       WHERE c.insumo_id = $1 AND i.status = 'ABERTO' AND c.inventario_id <> $2`,
      [dto.insumoId, id],
    );
    if (outro) {
      throw new BadRequestException(
        `Insumo já contado no inventário #${outro.inventario_id} (aberto) — feche um dos dois`,
      );
    }
    await this.db.execute(
      `INSERT INTO inventario_contagem (inventario_id, insumo_id, quantidade)
       VALUES ($1,$2,$3)
       ON CONFLICT (inventario_id, insumo_id)
       DO UPDATE SET quantidade = EXCLUDED.quantidade, contado_em = now()`,
      [id, dto.insumoId, dto.quantidade],
    );
    return this.detalharInventario(id);
  }

  async removerContagem(id: number, insumoId: number) {
    await this.inventarioAberto(id);
    const n = await this.db.execute(
      `DELETE FROM inventario_contagem WHERE inventario_id = $1 AND insumo_id = $2`,
      [id, insumoId],
    );
    if (!n) throw new NotFoundException('Contagem não encontrada neste inventário');
    return { ok: true };
  }

  /**
   * Fecha o inventário: cada diferença vira AJUSTE (origem CONTAGEM) —
   * sobra soma, falta baixa — avaliado ao custo médio atual.
   */
  async fecharInventario(id: number, user: { id: number; nome: string }) {
    const ajustes = await this.db.transaction(async (q) => {
      const rows = await q(`SELECT * FROM inventario WHERE id = $1 FOR UPDATE`, [id]);
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Inventário não encontrado');
      if (inv.status !== 'ABERTO') {
        throw new BadRequestException(`Inventário ${inv.status.toLowerCase()} — não pode fechar`);
      }
      const linhas = await q(
        `SELECT c.insumo_id, c.quantidade AS contado, i.custo_unitario,
                COALESCE((SELECT s.saldo FROM vw_saldo_insumo s WHERE s.insumo_id = c.insumo_id), 0) AS sistema
         FROM inventario_contagem c JOIN insumo i ON i.id = c.insumo_id
         WHERE c.inventario_id = $1`,
        [id],
      );
      if (!linhas.length) {
        throw new BadRequestException('Inventário vazio — lance ao menos uma contagem');
      }
      const feats: any[] = [];
      for (const l of linhas) {
        const diferenca = round3(num(l.contado) - num(l.sistema));
        if (diferenca === 0) continue;
        const tipo = diferenca > 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO';
        await q(
          `INSERT INTO estoque_movimento (insumo_id, tipo, quantidade, custo_unitario, origem, usuario_id, motivo)
           VALUES ($1,$2,$3,$4,'CONTAGEM',$5,$6)`,
          [
            l.insumo_id,
            tipo,
            Math.abs(diferenca),
            num(l.custo_unitario),
            user.id,
            `Inventário #${id} por ${user.nome} (contado ${num(l.contado)}, sistema ${num(l.sistema)})`,
          ],
        );
        feats.push({ insumo_id: l.insumo_id, diferenca });
      }
      await q(`UPDATE inventario SET status = 'FECHADO', fechado_em = now() WHERE id = $1`, [id]);
      return feats;
    });
    const det = await this.detalharInventario(id);
    return { ...det, ajustes_gerados: ajustes.length };
  }

  async cancelarInventario(id: number) {
    await this.inventarioAberto(id);
    await this.db.execute(`UPDATE inventario SET status = 'CANCELADO', fechado_em = now() WHERE id = $1`, [id]);
    return { ok: true };
  }

  // ---------- FASE 4: CMV e perdas ----------

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
   * CMV do período a partir das baixas (SAIDA_VENDA − estornos), por prato:
   * cmv, receita e % sobre a receita. Itens cancelados saem da receita.
   */
  async cmv(de?: string, ate?: string) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const custos = await this.db.query<any>(
      `SELECT pr.id AS produto_id, pr.nome AS produto,
              COALESCE(SUM(CASE WHEN m.tipo = 'SAIDA_VENDA'
                           THEN m.quantidade * COALESCE(m.custo_unitario, 0) ELSE 0 END), 0) AS cmv_bruto,
              COALESCE(SUM(CASE WHEN m.tipo = 'AJUSTE_POSITIVO' AND m.origem = 'CANCELAMENTO_ITEM'
                           THEN m.quantidade * COALESCE(m.custo_unitario, 0) ELSE 0 END), 0) AS estornos
       FROM estoque_movimento m
       JOIN pedido_item pi ON pi.id = m.pedido_item_id
       JOIN produto pr ON pr.id = pi.produto_id
       WHERE m.pedido_item_id IS NOT NULL
         AND (m.tipo = 'SAIDA_VENDA'
              OR (m.tipo = 'AJUSTE_POSITIVO' AND m.origem = 'CANCELAMENTO_ITEM'))
         AND m.data_movimento >= $1 AND m.data_movimento < $2
       GROUP BY pr.id, pr.nome`,
      [ini, fimExcl],
    );
    const vendas = await this.db.query<any>(
      `SELECT pr.id AS produto_id,
              COALESCE(SUM(pi.quantidade), 0) AS qtd,
              COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0) AS receita
       FROM pedido_item pi
       JOIN produto pr ON pr.id = pi.produto_id
       WHERE pi.status <> 'CANCELADO'
         AND EXISTS (SELECT 1 FROM estoque_movimento m
                     WHERE m.pedido_item_id = pi.id AND m.tipo = 'SAIDA_VENDA'
                       AND m.data_movimento >= $1 AND m.data_movimento < $2)
       GROUP BY pr.id`,
      [ini, fimExcl],
    );
    const vmap = new Map<number, any>(vendas.map((v: any) => [Number(v.produto_id), v]));
    let cmvTotal = 0;
    let receitaTotal = 0;
    const porProduto = custos
      .map((c: any) => {
        const cmv = Math.round((num(c.cmv_bruto) - num(c.estornos)) * 100) / 100;
        const v = vmap.get(Number(c.produto_id));
        const qtd = round3(num(v?.qtd));
        const receita = Math.round(num(v?.receita) * 100) / 100;
        cmvTotal = Math.round((cmvTotal + cmv) * 100) / 100;
        receitaTotal = Math.round((receitaTotal + receita) * 100) / 100;
        return {
          produto_id: Number(c.produto_id),
          produto: c.produto,
          qtd_vendida: qtd,
          receita,
          cmv,
          cmv_pct: receita > 0 ? Math.round((cmv / receita) * 1000) / 10 : null,
        };
      })
      .sort((a: any, b: any) => b.cmv - a.cmv);
    return {
      de: ini,
      ate: fim,
      cmv_total: cmvTotal,
      receita_total: receitaTotal,
      cmv_pct: receitaTotal > 0 ? Math.round((cmvTotal / receitaTotal) * 1000) / 10 : null,
      por_produto: porProduto,
    };
  }

  /**
   * Perdas do período (PERDA avaliadas ao custo do movimento ou custo
   * atual) + consumo interno em linha separada.
   */
  async perdas(de?: string, ate?: string) {
    const { ini, fim, fimExcl } = this.periodo(de, ate);
    const rows = await this.db.query<any>(
      `SELECT i.id AS insumo_id, i.nome AS insumo, um.sigla AS unidade,
              COALESCE(SUM(CASE WHEN m.tipo = 'PERDA' THEN m.quantidade ELSE 0 END), 0) AS qtd_perda,
              COALESCE(SUM(CASE WHEN m.tipo = 'PERDA'
                           THEN m.quantidade * COALESCE(m.custo_unitario, i.custo_unitario, 0) ELSE 0 END), 0) AS valor_perda,
              COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO_INTERNO'
                           THEN m.quantidade * COALESCE(m.custo_unitario, i.custo_unitario, 0) ELSE 0 END), 0) AS valor_consumo
       FROM estoque_movimento m
       JOIN insumo i ON i.id = m.insumo_id
       JOIN unidade_medida um ON um.id = i.unidade_estoque_id
       WHERE m.tipo IN ('PERDA', 'CONSUMO_INTERNO')
         AND m.data_movimento >= $1 AND m.data_movimento < $2
       GROUP BY i.id, i.nome, um.sigla
       ORDER BY valor_perda DESC`,
      [ini, fimExcl],
    );
    let perdaTotal = 0;
    let consumoTotal = 0;
    const porInsumo = rows.map((r: any) => {
      const valor = Math.round(num(r.valor_perda) * 100) / 100;
      const consumo = Math.round(num(r.valor_consumo) * 100) / 100;
      perdaTotal = Math.round((perdaTotal + valor) * 100) / 100;
      consumoTotal = Math.round((consumoTotal + consumo) * 100) / 100;
      return {
        insumo_id: Number(r.insumo_id),
        insumo: r.insumo,
        unidade: r.unidade,
        qtd_perda: round3(num(r.qtd_perda)),
        valor_perda: valor,
        valor_consumo_interno: consumo,
      };
    });
    return { de: ini, ate: fim, perda_total: perdaTotal, consumo_interno_total: consumoTotal, por_insumo: porInsumo };
  }
}
