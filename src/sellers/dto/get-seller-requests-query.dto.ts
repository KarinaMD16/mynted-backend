import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SellerRequestStatus } from '../../users/entities/user.entity';

export const LISTABLE_SELLER_REQUEST_STATUSES = [
  SellerRequestStatus.PENDING,
  SellerRequestStatus.APPROVED,
  SellerRequestStatus.REJECTED,
] as const;

export class GetSellerRequestsQueryDto {
  @ApiPropertyOptional({
    enum: LISTABLE_SELLER_REQUEST_STATUSES,
    default: SellerRequestStatus.PENDING,
    description: 'Estado de las solicitudes a listar (por defecto pending)',
  })
  @IsOptional()
  @IsIn(LISTABLE_SELLER_REQUEST_STATUSES, {
    message: 'status debe ser pending, approved o rejected',
  })
  status: SellerRequestStatus = SellerRequestStatus.PENDING;
}
