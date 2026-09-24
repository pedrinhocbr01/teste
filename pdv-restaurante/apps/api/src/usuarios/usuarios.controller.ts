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
import { UsuariosService } from './usuarios.service';
import { CriarUsuarioDto, AtualizarUsuarioDto, ResetPinDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser, AuthUser } from '../common/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('GERENTE', 'ADMIN')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  list() {
    return this.usuarios.list();
  }

  @Post()
  create(@Body() dto: CriarUsuarioDto) {
    return this.usuarios.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AtualizarUsuarioDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usuarios.update(id, dto, user.id);
  }

  @Post(':id/reset-pin')
  resetPin(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetPinDto) {
    return this.usuarios.resetPin(id, dto.pinNovo);
  }
}
