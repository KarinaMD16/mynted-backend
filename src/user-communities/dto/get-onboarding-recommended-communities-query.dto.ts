import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetOnboardingRecommendedCommunitiesQueryDto {
  @ApiPropertyOptional({
    type: Number,
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 50,
    description: 'Cantidad máxima de comunidades a recomendar',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
