import { ApiProperty } from '@nestjs/swagger';
import { EffectiveAssetDto } from '../../cosmetics/dto/cosmetics-response.dto';
import { ProductStatus } from '../../products/entities/product.entity';

// El otro participante de la conversación, visto por quien consulta.
export class ParticipantSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'karina_funko' })
  username!: string;

  @ApiProperty({
    example: 'Funko Corner CR',
    description: 'Nombre de la tienda si es vendedor; si no, su username',
  })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  photoUrl!: string | null;

  @ApiProperty({
    example: true,
    description: 'Vendedor verificado (false si no es vendedor)',
  })
  isVerified!: boolean;

  @ApiProperty({
    example: false,
    description: 'Tiene Pro vigente (suscripción con endsAt futuro)',
  })
  isPro!: boolean;

  @ApiProperty({
    type: EffectiveAssetDto,
    description:
      'Marco del avatar que se aplica ahora (el equipado si tiene derecho a usarlo; si no, el por defecto). Siempre presente',
  })
  frame!: EffectiveAssetDto;
}

export class ProductSummaryDto {
  @ApiProperty({ type: Number, example: 42 })
  id!: number;

  @ApiProperty({ example: 'Funko Pop Goku SSJ' })
  title!: string;

  @ApiProperty({ type: Number, example: 25000 })
  price!: number;

  @ApiProperty({
    type: Number,
    example: 22500,
    description: 'Precio con descuento aplicado',
  })
  finalPrice!: number;

  @ApiProperty({ type: String, nullable: true, example: 'CRC' })
  currency!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Imagen de portada',
  })
  imageUrl!: string | null;
}

export class ProductContextDto extends ProductSummaryDto {
  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiProperty({
    description:
      'false si el producto ya no está activo, está oculto o fue borrado. El chat sigue disponible igual',
  })
  isAvailable!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 47.5,
    description:
      'price en la moneda de visualización (informativo); null si no hay tipo de cambio',
  })
  displayPrice!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 42.75,
    description:
      'finalPrice en la moneda de visualización (informativo); null si no hay tipo de cambio',
  })
  displayFinalPrice!: number | null;

  @ApiProperty({ example: 'USD' })
  displayCurrency!: string;

  @ApiProperty({
    description:
      'true si displayPrice se obtuvo convirtiendo; false si la moneda coincide o no hubo tasa',
  })
  isConverted!: boolean;
}
