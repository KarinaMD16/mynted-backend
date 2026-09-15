import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SellerRequestStatus } from '../../users/entities/user.entity';

type SellerDecision =
  SellerRequestStatus.APPROVED | SellerRequestStatus.REJECTED;

export class UpdateSellerStatusDto {
  @ApiProperty({
    enum: [SellerRequestStatus.APPROVED, SellerRequestStatus.REJECTED],
    example: SellerRequestStatus.APPROVED,
  })
  @IsIn([SellerRequestStatus.APPROVED, SellerRequestStatus.REJECTED], {
    message: 'status debe ser approved o rejected',
  })
  status!: SellerDecision;
}
