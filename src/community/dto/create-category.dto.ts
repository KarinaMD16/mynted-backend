import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Coleccionismo' })
  @Transform(({ value }: TransformFnParams) => {
    const rawValue: unknown = value as unknown;
    return typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la categoría es obligatorio' })
  @Length(1, 100, {
    message: 'El nombre de la categoría debe tener entre 1 y 100 caracteres',
  })
  name!: string;
}
