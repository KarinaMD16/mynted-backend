import { ApiProperty } from '@nestjs/swagger';
import { BadgeRarity, BadgeScope } from '../entities/badge.entity';

// Forma exacta que consume el frontend.
export class BadgeItemDto {
  @ApiProperty({
    example: 'first_post',
    description: 'Contrato estable con el front: los SVG se asocian por code',
  })
  code!: string;

  @ApiProperty({
    example: 'Primera publicación',
    description: 'Texto de respaldo (es)',
  })
  name!: string;

  @ApiProperty({ example: 'Hizo su primera publicación en esta comunidad.' })
  description!: string;

  @ApiProperty({ enum: BadgeScope, example: BadgeScope.COMMUNITY })
  scope!: BadgeScope;

  @ApiProperty({ enum: BadgeRarity, example: BadgeRarity.COMMON })
  rarity!: BadgeRarity;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-08T15:30:00.000Z',
    description: 'null en el catálogo y en los badges derivados',
  })
  awardedAt!: Date | null;

  @ApiProperty({
    example: false,
    description:
      'true para community_founder y moderator: se derivan del rol del communityProfile, no se guardan',
  })
  derived!: boolean;
}

export class BackfillResultDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { verified_seller: 1, founding_member: 8, first_post: 40 },
    description: 'Cantidad de badges nuevos otorgados por code',
  })
  awarded!: Record<string, number>;
}
