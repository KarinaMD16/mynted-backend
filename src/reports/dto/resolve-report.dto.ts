import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveReportDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Ocultar el contenido reportado',
  })
  @IsOptional()
  @IsBoolean()
  hideContent?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Enviar una advertencia al autor',
  })
  @IsOptional()
  @IsBoolean()
  warnAuthor?: boolean;

  @ApiPropertyOptional({
    type: String,
    description:
      'Nota administrativa interna. Debe contener texto no vacío después de trim',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  note?: string;
}
