import { ApiProperty } from '@nestjs/swagger';

export class FeaturedProductResponseDto {
  @ApiProperty({ example: 42 })
  productId!: number;

  @ApiProperty({
    example: true,
    description: 'La preferencia de destacado está activa (featured_at)',
  })
  featuredEnabled!: boolean;

  @ApiProperty({
    example: true,
    description:
      'Se eleva de verdad ahora: producto activo, visible, con stock, de una comunidad pública (o sin comunidad) y vendedor con Pro vigente',
  })
  isFeatured!: boolean;

  @ApiProperty({ format: 'date-time' })
  featuredAt!: Date;
}

export class FeaturedSummaryDto {
  @ApiProperty({ example: 3, description: 'Tope de destacados por vendedor' })
  limit!: number;

  @ApiProperty({
    example: 1,
    description: 'Destacados efectivos ahora (los que de verdad se elevan)',
  })
  used!: number;

  @ApiProperty({ example: 2 })
  remaining!: number;
}
