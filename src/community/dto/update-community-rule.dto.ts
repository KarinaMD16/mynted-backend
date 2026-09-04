import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateCommunityRuleDto {
  @ApiProperty({
    example: 'Ser respetuoso con todos los miembros',
    description: 'Nuevo texto de la regla',
  })
  @IsString()
  @IsNotEmpty({ message: 'La descripción de la regla es obligatoria' })
  description!: string;
}
