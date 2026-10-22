import { ApiProperty } from '@nestjs/swagger';

export class ResponseTimeDto {
  @ApiProperty({
    example: 42,
    description:
      'Mediana, en minutos (redondeada), entre el primer mensaje del comprador y la primera respuesta del vendedor',
  })
  medianMinutes!: number;

  @ApiProperty({
    example: 12,
    description: 'Conversaciones respondidas en los últimos 90 días',
  })
  sampleSize!: number;
}

// Perfil público de la tienda. Nunca incluye payment_info ni el correo.
export class SellerStoreDto {
  @ApiProperty({ example: 4 })
  sellerId!: number;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'Funko Corner CR' })
  displayName!: string;

  @ApiProperty({ example: 'Funkos originales y ediciones limitadas' })
  description!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'San José, Costa Rica',
    description: 'La de la tienda; si está vacía, la del perfil del usuario',
  })
  location!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Foto de perfil del usuario',
  })
  photoUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Siempre null por ahora (pendiente)',
  })
  bannerUrl!: string | null;

  @ApiProperty({ example: true })
  isVerified!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.7,
    description: 'Promedio (1 decimal) de las reseñas de sus productos',
  })
  ratingAverage!: number | null;

  @ApiProperty({ example: 12 })
  reviewsCount!: number;

  @ApiProperty({ example: 15 })
  completedSalesCount!: number;

  @ApiProperty({
    example: 8,
    description:
      'Productos activos y visibles, sin contar los de comunidades privadas',
  })
  activeProductsCount!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Fecha de aprobación como vendedor (o, si no se registró, la del badge verified_seller)',
  })
  sellerSince!: Date | null;

  @ApiProperty({
    type: ResponseTimeDto,
    nullable: true,
    description: 'null si hay menos de 3 conversaciones respondidas',
  })
  responseTime!: ResponseTimeDto | null;
}

export class SellerTagDto {
  @ApiProperty({ example: 3 })
  tagId!: number;

  @ApiProperty({ example: 'Funko Pop' })
  name!: string;

  @ApiProperty({ example: 5, description: 'Productos públicos con ese tag' })
  count!: number;
}
