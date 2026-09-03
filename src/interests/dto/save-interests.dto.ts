import { ArrayMinSize, ArrayUnique, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SaveInterestsDto {
  @ApiProperty({
    example: [1, 2, 3],
    description: 'IDs de intereses seleccionados en el onboarding, mínimo 3',
    type: [Number],
  })
  @ArrayMinSize(3, {
    message: 'Debes elegir al menos 3 intereses para continuar',
  })
  @ArrayUnique()
  @IsInt({ each: true })
  interestIds!: number[];
}
