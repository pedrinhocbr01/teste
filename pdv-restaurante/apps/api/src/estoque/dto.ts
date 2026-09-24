import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
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

export class RecebimentoItemDto {
  @Type(() => Number)
  @IsInt()
  insumoId!: number;

  /** Quantidade na unidade de COMPRA (saco, cx...) se o insumo tiver uma;
   *  senão, direto na unidade de estoque. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantidade!: number;

  /** R$ TOTAL pago por esta linha (rateia pelo fator p/ atualizar o custo). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  custoTotal?: number;
}

export class ReceberCompraDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fornecedorId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecebimentoItemDto)
  itens!: RecebimentoItemDto[];
}

export class CriarInventarioDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  descricao?: string;
}

export class ContagemDto {
  @Type(() => Number)
  @IsInt()
  insumoId!: number;

  /** Quantidade contada, sempre na UNIDADE DE ESTOQUE do insumo. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantidade!: number;
}

export class PeriodoQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'de deve ser AAAA-MM-DD' })
  de?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'ate deve ser AAAA-MM-DD' })
  ate?: string;
}
