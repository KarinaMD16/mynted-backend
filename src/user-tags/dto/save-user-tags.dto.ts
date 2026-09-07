import { ArrayMinSize, ArrayUnique, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SaveUserTagsDto {
  @ApiProperty({
    example: [1, 2, 3],
    description:
      'IDs de tags principales (isInterest = true) elegidos en el onboarding, mínimo 3',
    type: [Number],
  })
  @ArrayMinSize(3, {
    message: 'Debes elegir al menos 3 intereses para continuar',
  })
  @ArrayUnique()
  @IsInt({ each: true })
  tagIds!: number[];
}
