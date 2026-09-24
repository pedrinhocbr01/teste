import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CriarContaDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  descricao?: string;

  @IsOptional()
  @IsBoolean()
  incluirServico?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  servicoPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  descontoValor?: number;

  /** Divisão igualitária: total fixo desta conta (não combina com itens). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valorRateio?: number;
}

export class AtualizarContaDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  descricao?: string;

  @IsOptional()
  @IsBoolean()
  incluirServico?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  servicoPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  descontoValor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valorRateio?: number;
}

export class AlocarItemDto {
  @Type(() => Number)
  @IsInt()
  pedidoItemId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantidade?: number;
}

export const FORMAS = [
  'DINHEIRO',
  'PIX',
  'CARTAO_CREDITO',
  'CARTAO_DEBITO',
  'VALE_ALIMENTACAO',
  'VALE_REFEICAO',
  'OUTRO',
] as const;

export class CriarPagamentoDto {
  @IsString()
  @IsIn([...FORMAS] as string[])
  forma!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  valor!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valorTroco?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referencia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacao?: string;

  /** Se omitido, usa o único caixa aberto (erro se 0 ou 2+). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  caixaId?: number;
}

export class CancelarPagamentoDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

export class DividirIgualDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  partes!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  descricoes?: string[];

  @IsOptional()
  @IsBoolean()
  incluirServico?: boolean;
}
