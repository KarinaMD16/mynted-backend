import { Transform, TransformFnParams } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class CreateCommunityRuleDto {
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['No realizar publicaciones ofensivas', 'No hacer spam'],
    description: 'Texto de una regla o arreglo de textos para crear varias',
  })
  @Transform(({ value }: TransformFnParams) => {
    if (value === undefined || value === null) return value as unknown;
    return Array.isArray(value) ? (value as unknown[]) : [value as unknown];
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe proporcionar al menos una regla' })
  @ArrayUnique({ message: 'No puede repetir reglas en la misma petición' })
  @IsString({ each: true })
  @IsNotEmpty({
    each: true,
    message: 'La descripción de cada regla es obligatoria',
  })
  description!: string[];
}
