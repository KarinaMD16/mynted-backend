import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTagDto {
  @ApiProperty({
    example: 'Coleccionismo',
    description: 'Nombre único del tag',
  })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del tag es obligatorio' })
  name!: string;
}
