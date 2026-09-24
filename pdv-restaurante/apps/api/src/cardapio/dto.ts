import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CriarCategoriaDto {
  @IsString()
  @MaxLength(80)
  nome!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  estacaoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;
}

export class AtualizarCategoriaDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  estacaoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class ListarProdutosQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoriaId?: number;

  @IsOptional()
  @IsString()
  @IsIn(['true', 'false'])
  ativos?: string;
}

export class CriarProdutoDto {
  @IsString()
  @MaxLength(120)
  nome!: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @Type(() => Number)
  @IsInt()
  categoriaId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  preco!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  estacaoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  insumoVinculadoId?: number;

  @IsOptional()
  @IsString()
  unidadePorcao?: string;
}

export class AtualizarProdutoDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoriaId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  preco?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  estacaoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  insumoVinculadoId?: number;

  @IsOptional()
  @IsString()
  unidadePorcao?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class FichaItemDto {
  @Type(() => Number)
  @IsInt()
  insumoId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantidade!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99)
  percaPct?: number;

  @IsOptional()
  @IsString()
  observacao?: string;
}

export class SalvarFichaDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  rendimento?: number;

  @IsOptional()
  @IsString()
  unidadeRendimento?: string;

  @IsOptional()
  @IsString()
  observacoes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FichaItemDto)
  itens!: FichaItemDto[];
}
