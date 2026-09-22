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
import { PedidosService } from './pedidos.service';
import {
  AdicionarItemDto,
  AtualizarItemDto,
  AvancarItemDto,
  CancelarItemDto,
  CriarPedidoDto,
  EnviarRemessaDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser, AuthUser } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Get()
  listar(@Query('status') status?: string, @Query('mesaId') mesaId?: string) {
    return this.pedidos.listar(status, mesaId ? Number(mesaId) : undefined);
  }

  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Post()
  criar(@Body() dto: CriarPedidoDto, @CurrentUser() user: AuthUser) {
    return this.pedidos.criar(dto, user);
  }

  @Get(':id')
  detalhar(@Param('id', ParseIntPipe) id: number) {
    return this.pedidos.detalhar(id);
  }

  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Post(':id/cancelar')
  cancelar(@Param('id', ParseIntPipe) id: number) {
    return this.pedidos.cancelarPedido(id);
  }

  // ---- itens (rascunho do garçom) ----
  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Post(':id/itens')
  adicionarItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdicionarItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pedidos.adicionarItem(id, dto, user.id);
  }

  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Patch(':id/itens/:itemId')
  atualizarItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: AtualizarItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pedidos.atualizarItem(id, itemId, dto, user.id);
  }

  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Delete(':id/itens/:itemId')
  removerItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pedidos.removerOuCancelarItem(id, itemId, undefined, user.id);
  }

  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Post(':id/itens/:itemId/cancelar')
  cancelarItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: CancelarItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pedidos.removerOuCancelarItem(id, itemId, dto.motivo, user.id);
  }

  // ---- envio para produção (gera baixa de estoque + fila de impressão) ----
  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Post(':id/enviar')
  enviar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnviarRemessaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pedidos.enviar(id, dto, user.id);
  }

  // ---- KDS: cozinha/bar avançam o preparo ----
  @Roles('COZINHEIRO', 'BAR', 'GARCOM', 'GERENTE', 'ADMIN')
  @Patch(':id/itens/:itemId/status')
  avancar(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: AvancarItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pedidos.avancarItem(id, itemId, dto.status, user.id);
  }
}
