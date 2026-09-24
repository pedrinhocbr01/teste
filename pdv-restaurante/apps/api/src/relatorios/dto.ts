import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class PeriodoQuery {
  @IsOptional()
  @Matches(DATA, { message: 'de deve ser AAAA-MM-DD' })
  de?: string;

  @IsOptional()
  @Matches(DATA, { message: 'ate deve ser AAAA-MM-DD' })
  ate?: string;
}

export class ProdutosQuery extends PeriodoQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}
