import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import { PdvGateway } from '../ws/pdv.gateway';
import { AtualizarMesaDto, CriarAreaDto, CriarMesaDto } from './dto';

@Injectable()
export class MesasService {
  constructor(
    private readonly db: DbService,
    private readonly ws: PdvGateway,
  ) {}

  listarAreas() {
    return this.db.query(`SELECT * FROM area ORDER BY nome`);
  }

  async criarArea(dto: CriarAreaDto) {
    try {
      const rows = await this.db.query(`INSERT INTO area (nome) VALUES ($1) RETURNING *`, [dto.nome]);
      return rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Área já existe');
      throw e;
    }
  }

  /** Mapa do salão: status + tempo de ocupação (view tempo-real). */
  mapa() {
    return this.db.query(`SELECT * FROM vw_mapa_mesas ORDER BY area, numero`);
  }

  async detalharMesa(id: number) {
    const mesa = await this.db.queryOne<any>(`SELECT * FROM vw_mapa_mesas WHERE mesa_id = $1`, [id]);
    if (!mesa) throw new NotFoundException('Mesa não encontrada');
    let pedido: any = null;
    if (mesa.pedido_id) {
      pedido = await this.db.queryOne(`SELECT * FROM pedido WHERE id = $1`, [mesa.pedido_id]);
      const itens = await this.db.query(
        `SELECT pi.*, p.nome AS produto_nome FROM pedido_item pi
         JOIN produto p ON p.id = pi.produto_id
         WHERE pi.pedido_id = $1 ORDER BY pi.id`,
        [mesa.pedido_id],
      );
      pedido = {
        ...pedido,
        itens: itens.map((i: any) => ({
          ...i,
          quantidade: num(i.quantidade),
          preco_unitario: num(i.preco_unitario),
        })),
      };
    }
    return { ...mesa, pedido };
  }

  async criarMesa(dto: CriarMesaDto) {
    try {
      const rows = await this.db.query(
        `INSERT INTO mesa (numero, area_id, capacidade, pos_x, pos_y)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [dto.numero, dto.areaId, dto.capacidade ?? 4, dto.posX ?? null, dto.posY ?? null],
      );
      return rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new BadRequestException('Número de mesa já existe');
      if (e?.code === '23503') throw new BadRequestException('Área inválida');
      throw e;
    }
  }

  async atualizarMesa(id: number, dto: AtualizarMesaDto, papel: string) {
    const isGerente = papel === 'GERENTE' || papel === 'ADMIN';
    // garçom/caixa só mexem em status e posição (fluxo do salão)
    if (!isGerente && (dto.capacidade !== undefined || dto.areaId !== undefined)) {
      throw new ForbiddenException('Só gerente altera capacidade/área da mesa');
    }
    if (dto.status === 'OCUPADA' || dto.status === 'AGUARDANDO_CONTA') {
      throw new BadRequestException(
        `Status ${dto.status} é controlado pelo sistema (pedidos/contas) — não dá p/ marcar manual`,
      );
    }
    if (dto.status === 'LIVRE' || dto.status === 'RESERVADA') {
      const aberto = await this.db.queryOne<any>(
        `SELECT id FROM pedido WHERE mesa_id = $1 AND status = 'ABERTO'`,
        [id],
      );
      if (aberto) {
        throw new BadRequestException(
          'Mesa com pedido aberto — feche ou cancele o pedido em vez de forçar o status',
        );
      }
    }
    const sets: string[] = [];
    const params: any[] = [];
    const push = (col: string, v: any) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.status !== undefined) push('status', dto.status);
    if (dto.capacidade !== undefined) push('capacidade', dto.capacidade);
    if (dto.posX !== undefined) push('pos_x', dto.posX);
    if (dto.posY !== undefined) push('pos_y', dto.posY);
    if (dto.areaId !== undefined) push('area_id', dto.areaId);
    if (!sets.length) throw new BadRequestException('Nada para atualizar');
    params.push(id);
    let row: any;
    try {
      row = await this.db.queryOne(
        `UPDATE mesa SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
    } catch (e: any) {
      if (e?.code === '23503') throw new BadRequestException('Área inválida');
      throw e;
    }
    if (!row) throw new NotFoundException('Mesa não encontrada');
    if (dto.status !== undefined) {
      this.ws.emitAll('mesa.status', { mesaId: id, status: dto.status });
    }
    return row;
  }
}
