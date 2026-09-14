import { ArrayUnique, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinCommunitiesDto {
  @ApiProperty({
    example: [1, 2, 3],
    description:
      'IDs de las comunidades recomendadas (según los intereses elegidos en ' +
      'POST /users/me/tags) que el usuario acepta. Puede venir vacío (flujo "Omitir por ahora").',
    type: [Number],
  })
  @ArrayUnique()
  @IsInt({ each: true })
  communityIds!: number[];
}
