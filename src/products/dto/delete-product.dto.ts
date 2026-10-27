import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DeleteProductDto {
  @ApiPropertyOptional({
    description: 'Motivo obligatorio únicamente para SUPERADMIN',
    maxLength: 500,
    example: 'Producto retirado por incumplimiento de políticas',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'reason debe ser un texto' })
  @MaxLength(500, { message: 'reason no puede superar 500 caracteres' })
  reason?: string;
}
