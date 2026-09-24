import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CaixaService } from './caixa.service';
import { AbrirCaixaDto, FecharCaixaDto, MovimentoCaixaDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser, AuthUser } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CAIXA', 'GERENTE', 'ADMIN')
@Controller('caixas')
export class CaixaController {
  constructor(private readonly caixa: CaixaService) {}

  @Get()
  listar(@Query('status') status?: string) {
    return this.caixa.listar(status);
  }

  // literal antes de :id
  @Get('meu-aberto')
  meuAberto(@CurrentUser() user: AuthUser) {
    return this.caixa.meuAberto(user.id);
  }

  @Get(':id')
  detalhar(@Param('id', ParseIntPipe) id: number) {
    return this.caixa.detalhar(id);
  }

  @Post('abrir')
  abrir(@Body() dto: AbrirCaixaDto, @CurrentUser() user: AuthUser) {
    return this.caixa.abrir(dto, user);
  }

  @Post(':id/movimentos')
  movimento(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MovimentoCaixaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.caixa.lancarMovimento(id, dto, user.id);
  }

  @Post(':id/fechar')
  fechar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FecharCaixaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.caixa.fechar(id, dto, user);
  }
}
