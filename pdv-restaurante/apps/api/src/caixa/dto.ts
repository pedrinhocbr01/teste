import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AbrirCaixaDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valorInicial?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacao?: string;
}

export class MovimentoCaixaDto {
  @IsString()
  @IsIn(['SANGRIA', 'SUPRIMENTO'])
  tipo!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  valor!: number;

  @IsString()
  @MinLength(3, { message: 'Motivo é obrigatório (mín. 3 letras)' })
  @MaxLength(300)
  motivo!: string;
}

export class FecharCaixaDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valorContado!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacao?: string;
}
