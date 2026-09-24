import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ContasService } from './contas.service';
import {
  AlocarItemDto,
  AtualizarContaDto,
  CancelarPagamentoDto,
  CriarContaDto,
  CriarPagamentoDto,
  DividirIgualDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser, AuthUser } from '../common/decorators/roles.decorator';

const SALAO = ['GARCOM', 'CAIXA', 'GERENTE', 'ADMIN'] as unknown as string[];
const CAIXA_OP = ['CAIXA', 'GERENTE', 'ADMIN'] as unknown as string[];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ContasController {
  constructor(private readonly contas: ContasService) {}

  // ---- contas do pedido ----
  @Get('pedidos/:id/contas')
  listar(@Param('id', ParseIntPipe) id: number) {
    return this.contas.listarPorPedido(id);
  }

  @Roles(...SALAO)
  @Post('pedidos/:id/contas')
  criar(@Param('id', ParseIntPipe) id: number, @Body() dto: CriarContaDto) {
    return this.contas.criar(id, dto);
  }

  @Roles(...SALAO)
  @Post('pedidos/:id/dividir-igual')
  dividirIgual(@Param('id', ParseIntPipe) id: number, @Body() dto: DividirIgualDto) {
    return this.contas.dividirIgual(id, dto);
  }

  /** "Fecha a conta": cria conta única c/ todos os itens + mesa AGUARDANDO_CONTA. */
  @Roles(...SALAO)
  @Post('pedidos/:id/imprimir-conta')
  imprimirConta(@Param('id', ParseIntPipe) id: number) {
    return this.contas.imprimirConta(id);
  }

  /** Fecha pedido quitado e sem pendências (libera a mesa). */
  @Roles(...CAIXA_OP)
  @Post('pedidos/:id/fechar')
  fecharPedido(@Param('id', ParseIntPipe) id: number) {
    return this.contas.fecharPedido(id);
  }

  // ---- conta individual ----
  @Get('contas/:id')
  detalhar(@Param('id', ParseIntPipe) id: number) {
    return this.contas.detalhar(id);
  }

  @Get('contas/:id/recibo')
  recibo(@Param('id', ParseIntPipe) id: number) {
    return this.contas.recibo(id);
  }

  @Roles(...SALAO)
  @Patch('contas/:id')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: AtualizarContaDto) {
    return this.contas.atualizar(id, dto);
  }

  @Roles(...SALAO)
  @Delete('contas/:id')
  cancelar(@Param('id', ParseIntPipe) id: number) {
    return this.contas.cancelar(id);
  }

  @Roles(...SALAO)
  @Post('contas/:id/fechar')
  fechar(@Param('id', ParseIntPipe) id: number) {
    return this.contas.fechar(id);
  }

  @Roles(...SALAO)
  @Post('contas/:id/itens')
  alocarItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AlocarItemDto) {
    return this.contas.alocarItem(id, dto);
  }

  @Roles(...SALAO)
  @Post('contas/:id/alocar-pendentes')
  alocarPendentes(@Param('id', ParseIntPipe) id: number) {
    return this.contas.alocarPendentes(id);
  }

  @Roles(...SALAO)
  @Delete('contas/:id/itens/:alocId')
  removerAlocacao(
    @Param('id', ParseIntPipe) id: number,
    @Param('alocId', ParseIntPipe) alocId: number,
  ) {
    return this.contas.removerAlocacao(id, alocId);
  }

  // ---- pagamentos ----
  @Get('contas/:id/pagamentos')
  listarPagamentos(@Param('id', ParseIntPipe) id: number) {
    return this.contas.listarPagamentos(id);
  }

  @Roles(...SALAO)
  @Post('contas/:id/pagamentos')
  pagar(@Param('id', ParseIntPipe) id: number, @Body() dto: CriarPagamentoDto) {
    return this.contas.criarPagamento(id, dto);
  }

  @Roles(...CAIXA_OP)
  @Post('pagamentos/:id/cancelar')
  estornar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelarPagamentoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contas.cancelarPagamento(id, dto, user);
  }
}
