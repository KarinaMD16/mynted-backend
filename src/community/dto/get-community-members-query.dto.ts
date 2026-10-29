import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommunityProfileRole } from '../entities/community-profile.entity';

const trimSearch = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class GetCommunityMembersQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: CommunityProfileRole })
  @IsOptional()
  @IsEnum(CommunityProfileRole)
  role?: CommunityProfileRole;

  @ApiPropertyOptional({
    description: 'Búsqueda parcial por username o displayName',
    example: 'nick',
  })
  @Transform(({ value }) => trimSearch({ value }))
  @IsOptional()
  @IsString()
  search?: string;
}
