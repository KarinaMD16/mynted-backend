import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResponseTimeDto } from '../../response-time/response-time.dto';
import { UserRole } from '../entities/user.entity';

// Solo vendedores aprobados (is_verified).
export class PublicSellerDto {
  @ApiProperty({
    example: 4,
    description: 'Para abrir la tienda: GET /sellers/:sellerId',
  })
  sellerId!: number;

  @ApiProperty({ example: 'Funko Corner CR' })
  displayName!: string;

  @ApiProperty({ example: true })
  isVerified!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.7,
    description: 'Promedio de las reseñas de sus productos (null si no tiene)',
  })
  ratingAverage!: number | null;

  @ApiProperty({ type: Number, example: 12 })
  reviewsCount!: number;

  @ApiProperty({
    type: ResponseTimeDto,
    nullable: true,
    description: 'null si hay menos de 3 conversaciones respondidas',
  })
  responseTime!: ResponseTimeDto | null;
}

/**
 * Vista pública de un usuario: nunca incluye correo, locale, moneda,
 * preferencias, estado de solicitud de vendedor ni versión de política.
 */
export class PublicUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'karina_funko' })
  username!: string;

  @ApiProperty({ type: String, nullable: true })
  photoUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;

  @ApiProperty({ type: String, nullable: true })
  location!: string | null;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({
    example: false,
    description: 'Tiene Pro vigente (suscripción con endsAt futuro)',
  })
  isPro!: boolean;

  @ApiPropertyOptional({
    type: PublicSellerDto,
    description: 'Solo si el usuario es vendedor aprobado',
  })
  seller?: PublicSellerDto;
}
