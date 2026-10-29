import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const normalizeOptional = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

export class ShipPaymentDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 120, example: 'ABC123' })
  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  trackingNumber?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 100,
    example: 'Correos de Costa Rica',
  })
  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrier?: string | null;
}
