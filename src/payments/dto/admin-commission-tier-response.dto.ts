import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionTierType } from '../enums/commission-tier-type.enum';

export class AdminCommissionTierResponseDto {
  @ApiProperty()
  id!: number;
  @ApiProperty({ enum: CommissionTierType })
  type!: CommissionTierType;
  @ApiProperty()
  name!: string;
  @ApiProperty()
  minValue!: number;
  @ApiPropertyOptional({ nullable: true })
  maxValue!: number | null;
  @ApiPropertyOptional({ nullable: true })
  currency!: string | null;
  @ApiProperty()
  discount!: number;
  @ApiProperty()
  isActive!: boolean;
}
