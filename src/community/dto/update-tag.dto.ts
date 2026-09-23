import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateTagDto {
  @ApiPropertyOptional({ example: 'Coleccionismo' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre del tag no puede estar vacío' })
  name?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Categoría general a la que pertenece el tag',
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'categoryId debe ser un número entero' })
  @Min(1)
  categoryId?: number | null;

  @ApiPropertyOptional({
    example: true,
    description:
      '[Superadmin] true = tag principal, visible en el picker de onboarding',
  })
  @IsOptional()
  @IsBoolean()
  isInterest?: boolean;
}
