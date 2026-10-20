import { PartialType } from '@nestjs/swagger';
import { CreateCommissionTierDto } from './admin-commission-tier-create.dto';

export class UpdateCommissionTierDto extends PartialType(
  CreateCommissionTierDto,
) {}
