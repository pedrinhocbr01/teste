import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DbService } from '../common/db/db.service';
import { PdvGateway } from '../ws/pdv.gateway';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AtualizarImpressaoDto, ReimprimirDto } from './dto';

/**
 * Fila de impressão — consumida pelo print-agent local (Fase 2):
 * polling GET ?status=PENDENTE (+FALHA p/ retry) e PATCH confirmando
 * IMPRESSA/FALHA. O agente devolve o texto renderizado em `conteudo`,
 * para conferência na demo/KDS ("como saiu no papel").
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('impressao-log')
export class ImpressaoController {
  constructor(
    private readonly db: DbService,
    private readonly ws: PdvGateway,
  ) {}

  @Get()
  fila(
    @Query('status') status = 'PENDENTE',
    @Query('estacaoId') estacaoId?: string,
    @Query('tipo') tipo?: string,
  ) {
    const where = [`($1 = 'TODOS' OR l.status = $1::tipo_status_impressao)`];
    const params: any[] = [status];
    if (estacaoId) {
      params.push(Number(estacaoId));
      where.push(`l.estacao_id = $${params.length}`);
    }
    if (tipo) {
      params.push(tipo);
      where.push(`l.tipo = $${params.length}`);
    }
    return this.db.query(
      `SELECT l.*, e.nome AS estacao_nome, e.tipo AS estacao_tipo,
              r.pedido_id, r.tipo AS remessa_tipo, p.mesa_id, m.numero AS mesa_numero
       FROM impressao_log l
       JOIN estacao e ON e.id = l.estacao_id
       JOIN remessa r ON r.id = l.remessa_id
       JOIN pedido p ON p.id = r.pedido_id
       JOIN mesa m ON m.id = p.mesa_id
       WHERE ${where.join(' AND ')}
       ORDER BY l.criado_em LIMIT 100`,
      params,
    );
  }

  /** Job + itens daquela estação (o que vai impresso na comanda). */
  @Get(':id')
  async job(@Param('id', ParseIntPipe) id: number) {
    const job = await this.db.queryOne<any>(
      `SELECT l.*, e.nome AS estacao_nome, e.tipo AS estacao_tipo,
              r.pedido_id, r.tipo AS remessa_tipo, r.enviado_em,
              p.mesa_id, m.numero AS mesa_numero,
              u.nome AS enviado_por_nome, g.nome AS garcom_nome,
              cfg.nome AS restaurante_nome
       FROM impressao_log l
       JOIN estacao e ON e.id = l.estacao_id
       JOIN remessa r ON r.id = l.remessa_id
       JOIN pedido p ON p.id = r.pedido_id
       JOIN mesa m ON m.id = p.mesa_id
       LEFT JOIN usuario u ON u.id = r.enviado_por
       LEFT JOIN usuario g ON g.id = p.garcom_id
       LEFT JOIN config_restaurante cfg ON cfg.id = 1
       WHERE l.id = $1`,
      [id],
    );
    if (!job) throw new NotFoundException('Job não encontrado');
    const itens =
      job.tipo === 'CANCELAMENTO'
        ? []
        : await this.db.query(
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
  async atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarImpressaoDto,
  ) {
    const sets = [`status = $1`, `tentativas = tentativas + 1`, `ultima_tentativa = now()`];
    const params: any[] = [dto.status];
    if (dto.conteudo !== undefined) {
      params.push(dto.conteudo);
      sets.push(`conteudo = $${params.length}`);
    }
    params.push(id);
    const row = await this.db.queryOne(
      `UPDATE impressao_log SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!row) throw new NotFoundException('Job não encontrado');
    return row;
  }

  /**
   * Reimpressão manual de uma remessa (papel atolou, apagou, cozinha perdeu).
   * Reaproveita job PRODUCAO pendente se existir; senão cria um novo.
   */
  @Roles('GARCOM', 'CAIXA', 'COZINHEIRO', 'BAR', 'GERENTE', 'ADMIN')
  @Post('remessa/:remessaId/reimprimir')
  async reimprimir(
    @Param('remessaId', ParseIntPipe) remessaId: number,
    @Body() dto: ReimprimirDto,
  ) {
    const remessa = await this.db.queryOne<any>(`SELECT * FROM remessa WHERE id = $1`, [remessaId]);
    if (!remessa) throw new NotFoundException('Remessa não encontrada');
    const estacoes = await this.db.query<any>(
      `SELECT DISTINCT COALESCE(p.estacao_id, c.estacao_id) AS estacao_id, e.nome AS estacao_nome
       FROM pedido_item pi
       JOIN produto p ON p.id = pi.produto_id
       JOIN categoria c ON c.id = p.categoria_id
       JOIN estacao e ON e.id = COALESCE(p.estacao_id, c.estacao_id)
       WHERE pi.remessa_id = $1`,
      [remessaId],
    );
    if (!estacoes.length) throw new BadRequestException('Remessa sem itens de produção');
    let alvos = estacoes;
    if (dto.estacaoId) {
      alvos = estacoes.filter((e: any) => Number(e.estacao_id) === dto.estacaoId);
      if (!alvos.length) {
        throw new BadRequestException('Esta estação não tem itens nesta remessa');
      }
    }
    const jobs: any[] = [];
    for (const est of alvos) {
      const pendente = await this.db.queryOne<any>(
        `SELECT * FROM impressao_log
         WHERE remessa_id = $1 AND estacao_id = $2 AND tipo = 'PRODUCAO' AND status = 'PENDENTE'
         ORDER BY id DESC LIMIT 1`,
        [remessaId, est.estacao_id],
      );
      if (pendente) {
        jobs.push({ ...pendente, reusado: true });
        continue;
      }
      try {
        const rows = await this.db.query(
          `INSERT INTO impressao_log (remessa_id, estacao_id, tipo)
           VALUES ($1, $2, 'PRODUCAO') RETURNING *`,
          [remessaId, est.estacao_id],
        );
        jobs.push({ ...rows[0], reusado: false });
      } catch (e: any) {
        // corrida com outro operador/agent: reaproveita o pendente
        if (e?.code !== '23505') throw e;
        const existente = await this.db.queryOne(
          `SELECT * FROM impressao_log
           WHERE remessa_id = $1 AND estacao_id = $2 AND tipo = 'PRODUCAO' AND status = 'PENDENTE'
           ORDER BY id DESC LIMIT 1`,
          [remessaId, est.estacao_id],
        );
        jobs.push({ ...existente, reusado: true });
      }
    }
    this.ws.emitToRooms(['cozinha', 'bar', 'caixa'], 'impressao.reprint', {
      remessaId,
      jobs: jobs.map((j: any) => ({ id: j.id, estacao_id: j.estacao_id, reusado: j.reusado })),
    });
    return { remessaId, jobs };
  }
}
