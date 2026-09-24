import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CardapioService } from './cardapio.service';
import {
  AtualizarCategoriaDto,
  AtualizarProdutoDto,
  CriarCategoriaDto,
  CriarProdutoDto,
  ListarProdutosQuery,
  SalvarFichaDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CardapioController {
  constructor(private readonly cardapio: CardapioService) {}

  @Get('estacoes')
  estacoes() {
    return this.cardapio.listarEstacoes();
  }

  @Get('categorias')
  categorias() {
    return this.cardapio.listarCategorias();
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('categorias')
  criarCategoria(@Body() dto: CriarCategoriaDto) {
    return this.cardapio.criarCategoria(dto);
  }

  @Roles('GERENTE', 'ADMIN')
  @Patch('categorias/:id')
  atualizarCategoria(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarCategoriaDto,
  ) {
    return this.cardapio.atualizarCategoria(id, dto);
  }

  @Get('produtos')
  produtos(@Query() q: ListarProdutosQuery) {
    return this.cardapio.listarProdutos(q);
  }

  @Get('produtos/:id')
  produto(@Param('id', ParseIntPipe) id: number) {
    return this.cardapio.detalharProduto(id);
  }

  @Get('produtos/:id/custo')
  custoProduto(@Param('id', ParseIntPipe) id: number) {
    return this.cardapio.custoDetalhado(id);
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('produtos')
  criarProduto(@Body() dto: CriarProdutoDto) {
    return this.cardapio.criarProduto(dto);
  }

  @Roles('GERENTE', 'ADMIN')
  @Patch('produtos/:id')
  atualizarProduto(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarProdutoDto,
  ) {
    return this.cardapio.atualizarProduto(id, dto);
  }

  @Roles('GERENTE', 'ADMIN')
  @Put('produtos/:id/ficha')
  salvarFicha(@Param('id', ParseIntPipe) id: number, @Body() dto: SalvarFichaDto) {
    return this.cardapio.salvarFicha(id, dto);
  }
}
