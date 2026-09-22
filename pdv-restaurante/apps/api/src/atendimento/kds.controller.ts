import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { DbService, num } from '../common/db/db.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

/**
 * KDS — Kitchen Display System (Fase 2).
 * Fila de produção por estação, com tempo de espera e cancelados recentes.
 * A tela foca em ENVIADO → EM_PREPARO → PRONTO; o avanço usa
 * PATCH /pedidos/:id/itens/:itemId/status.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kds')
export class KdsController {
  constructor(private readonly db: DbService) {}

  @Get('fila')
  async fila(@Query('estacao') estacao = 'COZINHA') {
    const key = String(estacao).toUpperCase();
    const porId = /^\d+$/.test(key);
    if (!porId && key !== 'COZINHA' && key !== 'BAR') {
      throw new BadRequestException('estacao deve ser COZINHA, BAR ou o id numérico');
    }
    const filtro = porId ? `COALESCE(p.estacao_id, c.estacao_id) = $1` : `e.tipo = $1::tipo_estacao`;
    const param = porId ? Number(key) : key;
    const base = `
       FROM pedido_item pi
       JOIN produto p ON p.id = pi.produto_id
       JOIN categoria c ON c.id = p.categoria_id
       JOIN estacao e ON e.id = COALESCE(p.estacao_id, c.estacao_id)
       JOIN remessa r ON r.id = pi.remessa_id
       JOIN pedido pd ON pd.id = pi.pedido_id
       JOIN mesa m ON m.id = pd.mesa_id
       LEFT JOIN usuario u ON u.id = pd.garcom_id
       WHERE ${filtro} AND pd.status = 'ABERTO'`;
    const cols = `
      SELECT pi.id AS item_id, pi.pedido_id, pi.status, pi.quantidade,
             pi.observacao, pi.ponto_carne, pi.atualizado_em,
             p.nome AS produto, c.nome AS categoria,
             e.id AS estacao_id, e.nome AS estacao_nome,
             r.id AS remessa_id, r.tipo AS remessa_tipo, r.enviado_em,
             m.numero AS mesa_numero, u.nome AS garcom,
             FLOOR(EXTRACT(EPOCH FROM (now() - r.enviado_em)) / 60) AS espera_min`;
    const items = await this.db.query<any>(
      `${cols} ${base} AND pi.status IN ('ENVIADO','EM_PREPARO','PRONTO')
       ORDER BY r.enviado_em, pi.id`,
      [param],
    );
    const cancelados = await this.db.query<any>(
      `${cols} ${base} AND pi.status = 'CANCELADO'
         AND pi.atualizado_em > now() - interval '15 minutes'
       ORDER BY pi.atualizado_em DESC LIMIT 20`,
      [param],
    );
    const cfg = await this.db.queryOne<any>(
      `SELECT tempo_medio_prato_min FROM config_restaurante WHERE id = 1`,
    );
    const map = (r: any) => ({ ...r, quantidade: num(r.quantidade), espera_min: Number(r.espera_min) });
    return {
      estacao: key,
      tempoMedioPratoMin: Number(cfg?.tempo_medio_prato_min ?? 25),
      items: items.map(map),
      cancelados: cancelados.map(map),
    };
  }
}
