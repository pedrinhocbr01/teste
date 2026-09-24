import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const PAPEIS = [
  'GARCOM',
  'CAIXA',
  'COZINHEIRO',
  'BAR',
  'GERENTE',
  'ADMIN',
] as const;

export class CriarUsuarioDto {
  @IsString()
  @MaxLength(120)
  nome!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN deve ter de 4 a 6 dígitos' })
  pin!: string;

  @IsIn([...PAPEIS] as string[])
  papel!: string;
}

export class AtualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn([...PAPEIS] as string[])
  papel?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class ResetPinDto {
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'novo PIN deve ter de 4 a 6 dígitos' })
  pinNovo!: string;
}
