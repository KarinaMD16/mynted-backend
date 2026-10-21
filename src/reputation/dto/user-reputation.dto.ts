import { ApiProperty } from '@nestjs/swagger';
import { BadgeItemDto } from '../../badges/dto/badge-item.dto';

// Cantidad de reseñas por estrellas. Siempre trae las 5 claves (0 si no hay).
export class RatingDistributionDto {
  @ApiProperty({ example: 0 })
  '1'!: number;

  @ApiProperty({ example: 0 })
  '2'!: number;

  @ApiProperty({ example: 1 })
  '3'!: number;

  @ApiProperty({ example: 3 })
  '4'!: number;

  @ApiProperty({ example: 8 })
  '5'!: number;
}

export class UserReputationDto {
  @ApiProperty({
    format: 'uuid',
    example: '6f1c2a9e-1b2c-4d3e-8f90-123456789abc',
  })
  userId!: string;

  @ApiProperty({
    example: true,
    description:
      'false si el usuario no es vendedor: ratingAverage null y conteos en 0',
  })
  isSeller!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.6,
    description:
      'Promedio (1 decimal) de las reseñas de todos sus productos; null si no tiene reseñas',
  })
  ratingAverage!: number | null;

  @ApiProperty({ example: 12 })
  reviewsCount!: number;

  @ApiProperty({ example: 15, description: 'Ventas completadas como vendedor' })
  completedSalesCount!: number;

  @ApiProperty({ type: RatingDistributionDto })
  ratingDistribution!: RatingDistributionDto;

  @ApiProperty({
    type: [BadgeItemDto],
    description:
      'Badges de usuario ganados (mismo orden que /users/:id/badges)',
  })
  badges!: BadgeItemDto[];
}
