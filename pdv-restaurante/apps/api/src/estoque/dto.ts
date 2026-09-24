import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CriarInsumoDto {
  @IsString()
  @MaxLength(120)
  nome!: string;

  @Type(() => Number)
  @IsInt()
  unidadeEstoqueId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unidadeCompraId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  fatorCompra?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  custoUnitario?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estoqueMinimo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estoqueMaximo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fornecedorPadraoId?: number;
}

export class AtualizarInsumoDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  custoUnitario?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estoqueMinimo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estoqueMaximo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fornecedorPadraoId?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export const TIPOS_MANUAIS = [
  'ENTRADA',
  'AJUSTE_POSITIVO',
  'AJUSTE_NEGATIVO',
  'PERDA',
  'CONSUMO_INTERNO',
] as const;

export class CriarMovimentoDto {
  @Type(() => Number)
  @IsInt()
  insumoId!: number;

  @IsIn([...TIPOS_MANUAIS] as string[], {
    message: 'SAIDA_VENDA é automática (via envio do pedido) — não lance manual',
  })
  tipo!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantidade!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  custoUnitario?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
