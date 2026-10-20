import { Transform, TransformFnParams } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SalesSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-01-01',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @Matches(ISO_DATE, { message: 'from debe usar YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-01-31',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @Matches(ISO_DATE, { message: 'to debe usar YYYY-MM-DD' })
  to?: string;
}
