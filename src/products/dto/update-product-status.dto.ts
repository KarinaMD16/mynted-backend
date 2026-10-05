import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProductStatus } from '../entities/product.entity';

type ProductStatusTransition = ProductStatus;

export class UpdateProductStatusDto {
  @ApiProperty({
    enum: [ProductStatus.ACTIVE, ProductStatus.SOLD, ProductStatus.INACTIVE],
    example: ProductStatus.SOLD,
    description:
      'active solo se permite para reactivar un producto que está inactive; un producto sold no puede volver a active',
  })
  @IsIn([ProductStatus.ACTIVE, ProductStatus.SOLD, ProductStatus.INACTIVE], {
    message: 'status debe ser active, sold o inactive',
  })
  status!: ProductStatusTransition;
}
