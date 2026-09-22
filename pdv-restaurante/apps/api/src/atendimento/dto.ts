import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CriarPedidoDto {
  @Type(() => Number)
  @IsInt()
  mesaId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  garcomId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacao?: string;
}

export class AdicionarItemDto {
  @Type(() => Number)
  @IsInt()
  produtoId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantidade?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  pontoCarne?: string;
}

export class AtualizarItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantidade?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  pontoCarne?: string;
}

export class EnviarRemessaDto {
  @IsString()
  @IsIn(['ENTRADA', 'PRINCIPAL', 'SOBREMESA', 'LIVRE'])
  tipo!: string;

  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  itemIds!: number[];
}

export class CancelarItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

export class AvancarItemDto {
  @IsString()
  @IsIn(['EM_PREPARO', 'PRONTO', 'ENTREGUE'])
  status!: string;
}

export class AtualizarImpressaoDto {
  @IsString()
  @IsIn(['IMPRESSA', 'FALHA'])
  status!: string;
}
