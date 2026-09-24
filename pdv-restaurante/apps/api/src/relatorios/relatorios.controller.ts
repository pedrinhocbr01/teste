import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RelatoriosService } from './relatorios.service';
import { PeriodoQuery, ProdutosQuery } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('GERENTE', 'ADMIN')
@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  @Get('vendas')
  vendas(@Query() q: PeriodoQuery) {
    return this.relatorios.vendas(q.de, q.ate);
  }

  @Get('produtos')
  produtos(@Query() q: ProdutosQuery) {
    return this.relatorios.produtos(q.de, q.ate, q.limite ?? 50);
  }

  @Get('categorias')
  categorias(@Query() q: PeriodoQuery) {
    return this.relatorios.categorias(q.de, q.ate);
  }

  @Get('garcons')
  garcons(@Query() q: PeriodoQuery) {
    return this.relatorios.garcons(q.de, q.ate);
  }

  @Get('mesas')
  mesas(@Query() q: PeriodoQuery) {
    return this.relatorios.mesas(q.de, q.ate);
  }

  @Get('caixas')
  caixas(@Query() q: PeriodoQuery) {
    return this.relatorios.caixas(q.de, q.ate);
  }
}
