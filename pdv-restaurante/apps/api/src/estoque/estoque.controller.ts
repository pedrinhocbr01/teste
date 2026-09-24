import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import {
  AtualizarInsumoDto,
  ContagemDto,
  CriarInsumoDto,
  CriarInventarioDto,
  CriarMovimentoDto,
  PeriodoQuery,
  ReceberCompraDto,
} from './dto';
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

  // ---------- Fase 4: recebimento, inventário e custos ----------

  @Roles('GERENTE', 'ADMIN')
  @Post('estoque/recebimento')
  receberCompra(@Body() dto: ReceberCompraDto, @CurrentUser() user: AuthUser) {
    return this.estoque.receberCompra(dto, user.id);
  }

  @Get('estoque/inventarios')
  inventarios() {
    return this.estoque.listarInventarios();
  }

  @Get('estoque/inventarios/:id')
  inventario(@Param('id', ParseIntPipe) id: number) {
    return this.estoque.detalharInventario(id);
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('estoque/inventarios')
  criarInventario(@Body() dto: CriarInventarioDto, @CurrentUser() user: AuthUser) {
    return this.estoque.criarInventario(dto, user.id);
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('estoque/inventarios/:id/contagens')
  lancarContagem(@Param('id', ParseIntPipe) id: number, @Body() dto: ContagemDto) {
    return this.estoque.lancarContagem(id, dto);
  }

  @Roles('GERENTE', 'ADMIN')
  @Delete('estoque/inventarios/:id/contagens/:insumoId')
  removerContagem(
    @Param('id', ParseIntPipe) id: number,
    @Param('insumoId', ParseIntPipe) insumoId: number,
  ) {
    return this.estoque.removerContagem(id, insumoId);
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('estoque/inventarios/:id/fechar')
  fecharInventario(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.estoque.fecharInventario(id, user);
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('estoque/inventarios/:id/cancelar')
  cancelarInventario(@Param('id', ParseIntPipe) id: number) {
    return this.estoque.cancelarInventario(id);
  }

  @Get('estoque/cmv')
  cmv(@Query() q: PeriodoQuery) {
    return this.estoque.cmv(q.de, q.ate);
  }

  @Get('estoque/perdas')
  perdas(@Query() q: PeriodoQuery) {
    return this.estoque.perdas(q.de, q.ate);
  }
}
