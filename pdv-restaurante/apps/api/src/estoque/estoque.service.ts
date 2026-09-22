import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import { AtualizarInsumoDto, CriarInsumoDto, CriarMovimentoDto } from './dto';

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
    const movimentos = await this.db.query(
      `SELECT m.*, u.nome AS usuario_nome FROM estoque_movimento m
       LEFT JOIN usuario u ON u.id = m.usuario_id
       WHERE m.insumo_id = $1 ORDER BY m.data_movimento DESC LIMIT 30`,
      [id],
    );
    return { ...insumo, saldo: num(insumo.saldo), movimentos };
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
    const row = await this.db.queryOne(
      `UPDATE insumo SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
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
}
