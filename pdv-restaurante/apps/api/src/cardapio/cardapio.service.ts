import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import {
  AtualizarCategoriaDto,
  AtualizarProdutoDto,
  CriarCategoriaDto,
  CriarProdutoDto,
  ListarProdutosQuery,
  SalvarFichaDto,
} from './dto';

@Injectable()
export class CardapioService {
  constructor(private readonly db: DbService) {}

  // ---- categorias ----
  listarCategorias() {
    return this.db.query(
      `SELECT c.id, c.nome, c.estacao_id, e.nome AS estacao_nome, e.tipo AS estacao_tipo,
              c.sort, c.ativo
       FROM categoria c LEFT JOIN estacao e ON e.id = c.estacao_id
       ORDER BY c.sort, c.nome`,
    );
  }

  async criarCategoria(dto: CriarCategoriaDto) {
    try {
      const rows = await this.db.query(
        `INSERT INTO categoria (nome, estacao_id, sort)
         VALUES ($1, $2, $3) RETURNING *`,
        [dto.nome, dto.estacaoId ?? null, dto.sort ?? 0],
      );
      return rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Categoria já existe');
      if (e?.code === '23503') throw new BadRequestException('Estação inválida');
      throw e;
    }
  }

  async atualizarCategoria(id: number, dto: AtualizarCategoriaDto) {
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, v: any) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.nome !== undefined) push('nome', dto.nome);
    if (dto.estacaoId !== undefined) push('estacao_id', dto.estacaoId);
    if (dto.sort !== undefined) push('sort', dto.sort);
    if (dto.ativo !== undefined) push('ativo', dto.ativo);
    if (!sets.length) throw new BadRequestException('Nada para atualizar');
    params.push(id);
    let row: any;
    try {
      row = await this.db.queryOne(
        `UPDATE categoria SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Categoria já existe');
      if (e?.code === '23503') throw new BadRequestException('Estação inválida');
      throw e;
    }
    if (!row) throw new NotFoundException('Categoria não encontrada');
    return row;
  }

  listarEstacoes() {
    return this.db.query(
      `SELECT e.id, e.nome, e.tipo, e.ativo,
              i.nome AS impressora, i.ip, i.porta
       FROM estacao e LEFT JOIN impressora i ON i.estacao_id = e.id AND i.ativa
       ORDER BY e.id`,
    );
  }

  // ---- produtos ----
  async listarProdutos(q: ListarProdutosQuery) {
    const where: string[] = [];
    const params: any[] = [];
    if (q.ativos !== 'false') where.push('p.ativo = TRUE');
    if (q.categoriaId) {
      params.push(q.categoriaId);
      where.push(`p.categoria_id = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`p.nome ILIKE $${params.length}`);
    }
    const rows = await this.db.query<any>(
      `SELECT p.id, p.nome, p.descricao, p.categoria_id, c.nome AS categoria,
              p.preco, p.estacao_id, p.insumo_vinculado_id, p.unidade_porcao, p.ativo,
              COALESCE(p.estacao_id, c.estacao_id) AS estacao_resolvida_id,
              cp.custo_por_porcao, cp.margem_pct
       FROM produto p
       JOIN categoria c ON c.id = p.categoria_id
       LEFT JOIN vw_custo_produto cp ON cp.produto_id = p.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.sort, p.nome`,
      params,
    );
    return rows.map((r) => ({
      ...r,
      preco: num(r.preco),
      custo_por_porcao: r.custo_por_porcao == null ? null : num(r.custo_por_porcao),
      margem_pct: r.margem_pct == null ? null : num(r.margem_pct),
    }));
  }

  async detalharProduto(id: number) {
    const produto = await this.db.queryOne<any>(
      `SELECT p.*, c.nome AS categoria,
              COALESCE(p.estacao_id, c.estacao_id) AS estacao_resolvida_id,
              cp.custo_por_porcao, cp.margem_pct
       FROM produto p
       JOIN categoria c ON c.id = p.categoria_id
       LEFT JOIN vw_custo_produto cp ON cp.produto_id = p.id
       WHERE p.id = $1`,
      [id],
    );
    if (!produto) throw new NotFoundException('Produto não encontrado');
    const ficha = await this.db.queryOne<any>(
      `SELECT * FROM ficha_tecnica WHERE produto_id = $1`,
      [id],
    );
    let itens: any[] = [];
    if (ficha) {
      itens = await this.db.query(
        `SELECT fti.*, i.nome AS insumo_nome, um.sigla AS unidade
         FROM ficha_tecnica_item fti
         JOIN insumo i ON i.id = fti.insumo_id
         JOIN unidade_medida um ON um.id = i.unidade_estoque_id
         WHERE fti.ficha_tecnica_id = $1 ORDER BY fti.id`,
        [ficha.id],
      );
    }
    return {
      ...produto,
      preco: num(produto.preco),
      ficha: ficha
        ? { ...ficha, rendimento: num(ficha.rendimento), itens: itens.map((i) => ({ ...i, quantidade: num(i.quantidade), perca_pct: num(i.perca_pct) })) }
        : null,
    };
  }

  async criarProduto(dto: CriarProdutoDto) {
    try {
      const rows = await this.db.query(
        `INSERT INTO produto (nome, descricao, categoria_id, preco, estacao_id, insumo_vinculado_id, unidade_porcao)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          dto.nome,
          dto.descricao ?? null,
          dto.categoriaId,
          dto.preco,
          dto.estacaoId ?? null,
          dto.insumoVinculadoId ?? null,
          dto.unidadePorcao ?? null,
        ],
      );
      return rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Produto já existe');
      if (e?.code === '23503') throw new BadRequestException('Categoria/estação/insumo inválido');
      throw e;
    }
  }

  async atualizarProduto(id: number, dto: AtualizarProdutoDto) {
    const map: Record<string, any> = {
      nome: dto.nome,
      descricao: dto.descricao,
      categoria_id: dto.categoriaId,
      preco: dto.preco,
      estacao_id: dto.estacaoId,
      insumo_vinculado_id: dto.insumoVinculadoId,
      unidade_porcao: dto.unidadePorcao,
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
        `UPDATE produto SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Produto já existe');
      if (e?.code === '23503') throw new BadRequestException('Categoria/estação/insumo inválido');
      throw e;
    }
    if (!row) throw new NotFoundException('Produto não encontrado');
    return row;
  }

  /** Substitui a ficha técnica inteira (transacional). */
  async salvarFicha(produtoId: number, dto: SalvarFichaDto) {
    const prod = await this.db.queryOne(`SELECT id FROM produto WHERE id = $1`, [produtoId]);
    if (!prod) throw new NotFoundException('Produto não encontrado');
    return this.db.transaction(async (q) => {
      const f = await q(
        `INSERT INTO ficha_tecnica (produto_id, rendimento, unidade_rendimento, observacoes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (produto_id) DO UPDATE SET
           rendimento = EXCLUDED.rendimento,
           unidade_rendimento = EXCLUDED.unidade_rendimento,
           observacoes = EXCLUDED.observacoes,
           atualizado_em = now()
         RETURNING *`,
        [produtoId, dto.rendimento ?? 1, dto.unidadeRendimento ?? null, dto.observacoes ?? null],
      );
      const ficha = f[0];
      await q(`DELETE FROM ficha_tecnica_item WHERE ficha_tecnica_id = $1`, [ficha.id]);
      for (const it of dto.itens) {
        await q(
          `INSERT INTO ficha_tecnica_item (ficha_tecnica_id, insumo_id, quantidade, perca_pct, observacao)
           VALUES ($1,$2,$3,$4,$5)`,
          [ficha.id, it.insumoId, it.quantidade, it.percaPct ?? 0, it.observacao ?? null],
        );
      }
      return this.detalharProduto(produtoId);
    });
  }
}
