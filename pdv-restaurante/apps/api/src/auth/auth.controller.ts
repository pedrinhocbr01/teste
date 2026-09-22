import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginPinDto, TrocarPinDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Login rápido do PDV: email (ou usuarioId) + PIN de 4–6 dígitos. */
  @Post('pin')
  login(@Body() dto: LoginPinDto) {
    return this.auth.loginPin(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('pin/trocar')
  trocar(
    @CurrentUser() user: AuthUser,
    @Body() dto: TrocarPinDto,
  ) {
    return this.auth.trocarPin(user.id, dto.pinAtual, dto.pinNovo);
  }
}
