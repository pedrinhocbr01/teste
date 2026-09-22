import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { AtualizarInsumoDto, CriarInsumoDto, CriarMovimentoDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser, AuthUser } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class EstoqueController {
  constructor(private readonly estoque: EstoqueService) {}

  @Get('estoque/saldos')
  saldos() {
    return this.estoque.saldos();
  }

  @Get('estoque/alertas')
  alertas(@Query('todos') todos?: string) {
    return this.estoque.alertas(todos !== 'true');
  }

  @Get('estoque/movimentos')
  movimentos(@Query('insumoId') insumoId?: string) {
    return this.estoque.listarMovimentos(insumoId ? Number(insumoId) : undefined);
  }

  @Roles('GERENTE', 'ADMIN', 'CAIXA')
  @Post('estoque/movimentos')
  lancar(@Body() dto: CriarMovimentoDto, @CurrentUser() user: AuthUser) {
    return this.estoque.lancarMovimento(dto, user.id);
  }

  @Get('insumos')
  insumos(@Query('q') q?: string) {
    return this.estoque.listarInsumos(q);
  }

  @Get('insumos/:id')
  insumo(@Param('id', ParseIntPipe) id: number) {
    return this.estoque.detalharInsumo(id);
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('insumos')
  criarInsumo(@Body() dto: CriarInsumoDto) {
    return this.estoque.criarInsumo(dto);
  }

  @Roles('GERENTE', 'ADMIN')
  @Patch('insumos/:id')
  atualizarInsumo(@Param('id', ParseIntPipe) id: number, @Body() dto: AtualizarInsumoDto) {
    return this.estoque.atualizarInsumo(id, dto);
  }

  @Get('unidades')
  unidades() {
    return this.estoque.listarUnidades();
  }

  @Get('fornecedores')
  fornecedores() {
    return this.estoque.listarFornecedores();
  }
}
