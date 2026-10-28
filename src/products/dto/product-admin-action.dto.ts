import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProductAdminActionDto {
  @ApiProperty({
    description: 'Motivo de la acción administrativa',
    maxLength: 500,
    example: 'Incumplimiento de políticas comerciales',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'reason debe ser un texto' })
  @IsNotEmpty({ message: 'reason es obligatorio' })
  @MaxLength(500, { message: 'reason no puede superar 500 caracteres' })
  reason!: string;
}
