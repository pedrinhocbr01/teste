import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import { PdvGateway } from '../ws/pdv.gateway';
import {
  AdicionarItemDto,
  AtualizarItemDto,
  CriarPedidoDto,
  EnviarRemessaDto,
} from './dto';

const ORDEM_STATUS = ['RASCUNHO', 'ENVIADO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE'];

@Injectable()
export class PedidosService {
  constructor(
    private readonly db: DbService,
    private readonly ws: PdvGateway,
  ) {}

  async listar(status?: string, mesaId?: number) {
    const where: string[] = [];
    const params: any[] = [];
    if (status) {
      params.push(status);
      where.push(`p.status = $${params.length}`);
    }
    if (mesaId) {
      params.push(mesaId);
      where.push(`p.mesa_id = $${params.length}`);
    }
    const rows = await this.db.query<any>(
      `SELECT p.*, m.numero AS mesa_numero, u.nome AS garcom_nome,
              (SELECT COUNT(*) FROM pedido_item pi WHERE pi.pedido_id = p.id AND pi.status <> 'CANCELADO') AS itens,
              COALESCE((SELECT SUM(pi.quantidade * pi.preco_unitario) FROM pedido_item pi
                        WHERE pi.pedido_id = p.id AND pi.status <> 'CANCELADO'), 0) AS total
       FROM pedido p
       JOIN mesa m ON m.id = p.mesa_id
       LEFT JOIN usuario u ON u.id = p.garcom_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.aberto_em DESC LIMIT 100`,
      params,
    );
    return rows.map((r) => ({ ...r, total: num(r.total), itens: Number(r.itens) }));
  }

  async criar(dto: CriarPedidoDto, user: { id: number; papel: string }) {
    const mesa = await this.db.queryOne<any>(`SELECT * FROM mesa WHERE id = $1 AND ativo`, [dto.mesaId]);
    if (!mesa) throw new NotFoundException('Mesa não encontrada');
    // garçom sempre assume o próprio pedido; gerente/caixa podem atribuir
    const garcomId = user.papel === 'GARCOM' ? user.id : (dto.garcomId ?? user.id);
    try {
      const rows = await this.db.query<any>(
        `INSERT INTO pedido (mesa_id, garcom_id, observacao) VALUES ($1,$2,$3) RETURNING *`,
        [dto.mesaId, garcomId, dto.observacao ?? null],
      );
      const pedido = rows[0];
      this.ws.emitAll('mesa.status', { mesaId: dto.mesaId, status: 'OCUPADA', pedidoId: pedido.id });
      return pedido;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          `Mesa ${mesa.numero} já tem pedido aberto — use o pedido existente`,
        );
      }
      throw e;
    }
  }

  async detalhar(id: number) {
    const pedido = await this.db.queryOne<any>(
      `SELECT p.*, m.numero AS mesa_numero, u.nome AS garcom_nome
       FROM pedido p JOIN mesa m ON m.id = p.mesa_id
       LEFT JOIN usuario u ON u.id = p.garcom_id WHERE p.id = $1`,
      [id],
    );
    if (!pedido) throw new NotFoundException('Pedido não encontrado');
    const itens = await this.db.query<any>(
      `SELECT pi.*, p.nome AS produto_nome, c.nome AS categoria,
              COALESCE(p.estacao_id, c.estacao_id) AS estacao_id
       FROM pedido_item pi
       JOIN produto p ON p.id = pi.produto_id
       JOIN categoria c ON c.id = p.categoria_id
       WHERE pi.pedido_id = $1 ORDER BY pi.id`,
      [id],
    );
    const remessas = await this.db.query(`SELECT * FROM remessa WHERE pedido_id = $1 ORDER BY id`, [id]);
    const contas = await this.db.query(`SELECT * FROM vw_conta_resumo WHERE pedido_id = $1`, [id]);
    const total = itens
      .filter((i) => i.status !== 'CANCELADO')
      .reduce((s, i) => s + num(i.quantidade) * num(i.preco_unitario), 0);
    return {
      ...pedido,
      itens: itens.map((i) => ({ ...i, quantidade: num(i.quantidade), preco_unitario: num(i.preco_unitario) })),
      remessas,
      contas,
      total: Math.round(total * 100) / 100,
    };
  }

  private async pedidoAberto(id: number) {
    const p = await this.db.queryOne<any>(`SELECT * FROM pedido WHERE id = $1`, [id]);
    if (!p) throw new NotFoundException('Pedido não encontrado');
    if (p.status !== 'ABERTO') throw new BadRequestException(`Pedido ${p.status.toLowerCase()} — não pode alterar`);
    return p;
  }

  /** Garçom lança item em RASCUNHO (preço = snapshot do cardápio). */
  async adicionarItem(pedidoId: number, dto: AdicionarItemDto, userId: number) {
    const pedido = await this.pedidoAberto(pedidoId);
    const prod = await this.db.queryOne<any>(
      `SELECT id, nome, preco FROM produto WHERE id = $1 AND ativo`,
      [dto.produtoId],
    );
    if (!prod) throw new NotFoundException('Produto não encontrado ou inativo');
    const rows = await this.db.query<any>(
      `INSERT INTO pedido_item (pedido_id, produto_id, quantidade, preco_unitario, observacao, ponto_carne, atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        pedidoId,
        dto.produtoId,
        dto.quantidade ?? 1,
        prod.preco,
        dto.observacao ?? null,
        dto.pontoCarne ?? null,
        userId,
      ],
    );
    const item = { ...rows[0], produto_nome: prod.nome };
    this.ws.emitToRooms([`mesa:${pedido.mesa_id}`, `pedido:${pedidoId}`, 'caixa'], 'item.adicionado', {
      pedidoId, mesaId: pedido.mesa_id, item,
    });
    return item;
  }

  async atualizarItem(pedidoId: number, itemId: number, dto: AtualizarItemDto, userId: number) {
    await this.pedidoAberto(pedidoId);
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, v: any) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.quantidade !== undefined) push('quantidade', dto.quantidade);
    if (dto.observacao !== undefined) push('observacao', dto.observacao);
    if (dto.pontoCarne !== undefined) push('ponto_carne', dto.pontoCarne);
    if (!sets.length) throw new BadRequestException('Nada para atualizar');
    params.push(userId, pedidoId, itemId);
    const row = await this.db.queryOne(
      `UPDATE pedido_item SET ${sets.join(', ')}, atualizado_por = $${params.length - 2}
       WHERE pedido_id = $${params.length - 1} AND id = $${params.length} AND status = 'RASCUNHO'
       RETURNING *`,
      params,
    );
    if (!row) {
      throw new BadRequestException(
        'Item não encontrado, não é deste pedido ou já foi enviado (só rascunho edita)',
      );
    }
    return row;
  }

  /** Remove rascunho (DELETE) ou cancela item enviado (CANCELADO + estorno automático). */
  async removerOuCancelarItem(pedidoId: number, itemId: number, motivo: string | undefined, userId: number) {
    const pedido = await this.pedidoAberto(pedidoId);
    const item = await this.db.queryOne<any>(
      `SELECT * FROM pedido_item WHERE id = $1 AND pedido_id = $2`,
      [itemId, pedidoId],
    );
    if (!item) throw new NotFoundException('Item não encontrado neste pedido');
    if (item.status === 'CANCELADO') throw new BadRequestException('Item já cancelado');
    if (item.status === 'RASCUNHO') {
      await this.db.execute(`DELETE FROM pedido_item WHERE id = $1`, [itemId]);
      this.ws.emitToRooms([`mesa:${pedido.mesa_id}`, `pedido:${pedidoId}`], 'item.status', {
        pedidoId, mesaId: pedido.mesa_id, itemId, status: 'REMOVIDO',
      });
      return { ok: true, acao: 'removido' };
    }
    await this.db.execute(
      `UPDATE pedido_item SET status = 'CANCELADO', motivo_cancelamento = $1, atualizado_por = $2 WHERE id = $3`,
      [motivo ?? 'Cancelado pelo salão', userId, itemId],
    );
    this.ws.emitToRooms(
      [`mesa:${pedido.mesa_id}`, `pedido:${pedidoId}`, 'cozinha', 'bar', 'caixa'],
      'item.status',
      { pedidoId, mesaId: pedido.mesa_id, itemId, status: 'CANCELADO' },
    );
    return { ok: true, acao: 'cancelado_com_estorno' };
  }

  /**
   * ENVIO — o garçom aperta "enviar": cria a remessa (onda) e os itens saem
   * de RASCUNHO → ENVIADO. Os triggers do banco fazem o resto:
   * baixa de estoque pela ficha técnica + 1 job de impressão por estação.
   */
  async enviar(pedidoId: number, dto: EnviarRemessaDto, userId: number) {
    const pedido = await this.pedidoAberto(pedidoId);
    const ids = [...new Set(dto.itemIds)];
    const result = await this.db.transaction(async (q) => {
      const existentes = await q(
        `SELECT id, status FROM pedido_item WHERE pedido_id = $1 AND id = ANY($2)`,
        [pedidoId, ids],
      );
      if (existentes.length !== ids.length) {
        throw new BadRequestException('Algum item não pertence a este pedido');
      }
      const naoRascunho = existentes.filter((i: any) => i.status !== 'RASCUNHO');
      if (naoRascunho.length) {
        throw new BadRequestException(
          `Itens ${naoRascunho.map((i: any) => i.id).join(', ')} já foram enviados`,
        );
      }
      const rem = await q(
        `INSERT INTO remessa (pedido_id, tipo, enviado_por) VALUES ($1,$2,$3) RETURNING *`,
        [pedidoId, dto.tipo, userId],
      );
      const remessa = rem[0];
      await q(
        `UPDATE pedido_item SET remessa_id = $1, status = 'ENVIADO', atualizado_por = $2
         WHERE pedido_id = $3 AND id = ANY($4)`,
        [remessa.id, userId, pedidoId, ids],
      );
      const jobs = await q(
        `SELECT l.id, l.estacao_id, e.nome AS estacao_nome, e.tipo AS estacao_tipo, l.status
         FROM impressao_log l JOIN estacao e ON e.id = l.estacao_id
         WHERE l.remessa_id = $1`,
        [remessa.id],
      );
      const itens = await q(
        `SELECT pi.*, p.nome AS produto_nome, c.nome AS categoria,
                COALESCE(p.estacao_id, c.estacao_id) AS estacao_id
         FROM pedido_item pi
         JOIN produto p ON p.id = pi.produto_id
         JOIN categoria c ON c.id = p.categoria_id
         WHERE pi.id = ANY($1) ORDER BY pi.id`,
        [ids],
      );
      return { remessa, jobs, itens };
    });
    this.ws.emitToRooms(
      [`mesa:${pedido.mesa_id}`, `pedido:${pedidoId}`, 'cozinha', 'bar', 'caixa'],
      'pedido.enviado',
      { pedidoId, mesaId: pedido.mesa_id, tipo: dto.tipo, ...result },
    );
    return { pedidoId, mesaId: pedido.mesa_id, ...result };
  }

  /** KDS (cozinha/bar): avança ENVIADO → EM_PREPARO → PRONTO → ENTREGUE. */
  async avancarItem(pedidoId: number, itemId: number, status: string, userId: number) {
    const pedido = await this.db.queryOne<any>(`SELECT * FROM pedido WHERE id = $1`, [pedidoId]);
    if (!pedido) throw new NotFoundException('Pedido não encontrado');
    const item = await this.db.queryOne<any>(
      `SELECT * FROM pedido_item WHERE id = $1 AND pedido_id = $2`,
      [itemId, pedidoId],
    );
    if (!item) throw new NotFoundException('Item não encontrado neste pedido');
    if (item.status === 'CANCELADO' || item.status === 'RASCUNHO') {
      throw new BadRequestException(`Item ${item.status.toLowerCase()} não avança`);
    }
    if (ORDEM_STATUS.indexOf(status) <= ORDEM_STATUS.indexOf(item.status)) {
      throw new BadRequestException(`Transição inválida: ${item.status} → ${status}`);
    }
    await this.db.execute(
      `UPDATE pedido_item SET status = $1, atualizado_por = $2 WHERE id = $3`,
      [status, userId, itemId],
    );
    this.ws.emitToRooms(
      [`mesa:${pedido.mesa_id}`, `pedido:${pedidoId}`, 'cozinha', 'bar', 'caixa'],
      'item.status',
      { pedidoId, mesaId: pedido.mesa_id, itemId, status },
    );
    return { ok: true, itemId, status };
  }

  /** Cancela pedido inteiro (só sem itens enviados; senão cancele item a item). */
  async cancelarPedido(pedidoId: number) {
    const pedido = await this.pedidoAberto(pedidoId);
    const enviados = await this.db.queryOne<any>(
      `SELECT COUNT(*)::int AS n FROM pedido_item
       WHERE pedido_id = $1 AND status NOT IN ('RASCUNHO','CANCELADO')`,
      [pedidoId],
    );
    if (enviados && Number(enviados.n) > 0) {
      throw new BadRequestException(
        'Pedido tem itens já enviados — cancele os itens antes de cancelar o pedido',
      );
    }
    await this.db.execute(`UPDATE pedido SET status = 'CANCELADO', fechado_em = now() WHERE id = $1`, [pedidoId]);
    this.ws.emitAll('mesa.status', { mesaId: pedido.mesa_id, status: 'LIVRE', pedidoId });
    return { ok: true };
  }
}
