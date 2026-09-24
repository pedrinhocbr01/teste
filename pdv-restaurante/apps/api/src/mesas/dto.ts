import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CriarAreaDto {
  @IsString()
  @MaxLength(60)
  nome!: string;
}

export class CriarMesaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  numero!: number;

  @Type(() => Number)
  @IsInt()
  areaId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacidade?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posY?: number;
}

export class AtualizarMesaDto {
  @IsOptional()
  @IsString()
  @IsIn(['LIVRE', 'OCUPADA', 'AGUARDANDO_CONTA', 'RESERVADA'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacidade?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posY?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  areaId?: number;
}
