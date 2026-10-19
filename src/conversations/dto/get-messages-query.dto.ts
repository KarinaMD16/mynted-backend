import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetMessagesQueryDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    example: 120,
    description:
      'nextCursor de la página anterior. Sin cursor se devuelven los más recientes',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'cursor debe ser un entero positivo' })
  @Min(1, { message: 'cursor debe ser un entero positivo' })
  cursor?: number;

  @ApiPropertyOptional({ type: Number, default: 30, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;
}
