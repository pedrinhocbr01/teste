import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DbService } from '../common/db/db.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AtualizarImpressaoDto } from './dto';

/**
 * Fila de impressão — consumida pelo print-agent local na Fase 2
 * (polling GET ?status=PENDENTE + PATCH confirmando IMPRESSA/FALHA).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('impressao-log')
export class ImpressaoController {
  constructor(private readonly db: DbService) {}

  @Get()
  fila(@Query('status') status = 'PENDENTE') {
    return this.db.query(
      `SELECT l.*, e.nome AS estacao_nome, e.tipo AS estacao_tipo,
              r.pedido_id, r.tipo AS remessa_tipo, p.mesa_id, m.numero AS mesa_numero
       FROM impressao_log l
       JOIN estacao e ON e.id = l.estacao_id
       JOIN remessa r ON r.id = l.remessa_id
       JOIN pedido p ON p.id = r.pedido_id
       JOIN mesa m ON m.id = p.mesa_id
       WHERE ($1 = 'TODOS' OR l.status = $1::tipo_status_impressao)
       ORDER BY l.criado_em LIMIT 100`,
      [status],
    );
  }

  /** Job + itens daquela estação (o que vai impresso na comanda). */
  @Get(':id')
  async job(@Param('id', ParseIntPipe) id: number) {
    const job = await this.db.queryOne<any>(
      `SELECT l.*, e.nome AS estacao_nome, r.pedido_id, r.tipo AS remessa_tipo,
              m.numero AS mesa_numero, u.nome AS enviado_por_nome
       FROM impressao_log l
       JOIN estacao e ON e.id = l.estacao_id
       JOIN remessa r ON r.id = l.remessa_id
       JOIN pedido p ON p.id = r.pedido_id
       JOIN mesa m ON m.id = p.mesa_id
       LEFT JOIN usuario u ON u.id = r.enviado_por
       WHERE l.id = $1`,
      [id],
    );
    if (!job) return null;
    const itens = await this.db.query(
      `SELECT pi.id, pi.quantidade, pi.observacao, pi.ponto_carne, p.nome AS produto
       FROM pedido_item pi
       JOIN produto p ON p.id = pi.produto_id
       JOIN categoria c ON c.id = p.categoria_id
       WHERE pi.remessa_id = $1 AND COALESCE(p.estacao_id, c.estacao_id) = $2
       ORDER BY pi.id`,
      [job.remessa_id, job.estacao_id],
    );
    return { ...job, itens };
  }

  @Patch(':id')
  async atualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: AtualizarImpressaoDto) {
    const row = await this.db.queryOne(
      `UPDATE impressao_log
       SET status = $1, tentativas = tentativas + 1, ultima_tentativa = now()
       WHERE id = $2 RETURNING *`,
      [dto.status, id],
    );
    return row;
  }
}
