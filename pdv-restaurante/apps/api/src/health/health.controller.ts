import { Controller, Get } from '@nestjs/common';
import { DbService } from '../common/db/db.service';

@Controller()
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  root() {
    return {
      app: 'pdv-restaurante API — Fase 1',
      docs: 'Veja pdv-restaurante/README.md (seção Fase 1) e /demo.html',
      health: '/health',
      login: 'POST /auth/pin { email, pin }',
      ws: 'Socket.IO — envie { rooms: ["cozinha","mesa:3"] } no evento "join"',
    };
  }

  @Get('health')
  async health() {
    await this.db.query('SELECT 1');
    const cfg = await this.db.queryOne<any>(
      `SELECT nome, gorjeta_percentual, baixa_estoque_em FROM config_restaurante WHERE id = 1`,
    );
    return {
      status: 'ok',
      driver: this.db.driver,
      time: new Date().toISOString(),
      restaurante: cfg,
    };
  }
}
