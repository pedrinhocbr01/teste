import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LoginPinDto {
  @IsOptional()
  @IsEmail({}, { message: 'email inválido' })
  email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usuarioId?: number;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN deve ter de 4 a 6 dígitos' })
  pin!: string;
}

export class TrocarPinDto {
  @IsString()
  pinAtual!: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'novo PIN deve ter de 4 a 6 dígitos' })
  pinNovo!: string;
}
