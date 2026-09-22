import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MesasService } from './mesas.service';
import { AtualizarMesaDto, CriarAreaDto, CriarMesaDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser, AuthUser } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class MesasController {
  constructor(private readonly mesas: MesasService) {}

  @Get('areas')
  areas() {
    return this.mesas.listarAreas();
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('areas')
  criarArea(@Body() dto: CriarAreaDto) {
    return this.mesas.criarArea(dto);
  }

  @Get('mesas/mapa')
  mapa() {
    return this.mesas.mapa();
  }

  // IMPORTANT: rotas literais acima de :id
  @Get('mesas')
  listar() {
    return this.mesas.mapa();
  }

  @Get('mesas/:id')
  detalhar(@Param('id', ParseIntPipe) id: number) {
    return this.mesas.detalharMesa(id);
  }

  @Roles('GERENTE', 'ADMIN')
  @Post('mesas')
  criar(@Body() dto: CriarMesaDto) {
    return this.mesas.criarMesa(dto);
  }

  @Roles('GARCOM', 'CAIXA', 'GERENTE', 'ADMIN')
  @Patch('mesas/:id')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarMesaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mesas.atualizarMesa(id, dto, user.papel);
  }
}
