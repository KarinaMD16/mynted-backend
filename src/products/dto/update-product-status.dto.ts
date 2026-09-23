import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProductStatus } from '../entities/product.entity';

type ProductStatusTransition = ProductStatus.SOLD | ProductStatus.INACTIVE;

export class UpdateProductStatusDto {
  @ApiProperty({
    enum: [ProductStatus.SOLD, ProductStatus.INACTIVE],
    example: ProductStatus.SOLD,
    description:
      'No se puede volver a "active" desde este endpoint una vez marcado sold/inactive',
  })
  @IsIn([ProductStatus.SOLD, ProductStatus.INACTIVE], {
    message: 'status debe ser sold o inactive',
  })
  status!: ProductStatusTransition;
}
