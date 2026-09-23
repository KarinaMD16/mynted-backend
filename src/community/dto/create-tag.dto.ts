import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateTagDto {
  @ApiProperty({
    example: 'Coleccionismo',
    description: 'Nombre único del tag',
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del tag es obligatorio' })
  name!: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Categoría general a la que pertenece el tag (opcional, ayuda a filtrar tags hiper específicos)',
  })
  @IsOptional()
  @IsInt({ message: 'categoryId debe ser un número entero' })
  @Min(1)
  categoryId?: number;
}
