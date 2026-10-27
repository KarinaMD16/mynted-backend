import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SellerRequestStatus } from '../entities/user.entity';

export class GetUsersQueryDto {
  @ApiPropertyOptional({ enum: SellerRequestStatus })
  @IsOptional()
  @IsEnum(SellerRequestStatus)
  sellerStatus?: SellerRequestStatus;
}
