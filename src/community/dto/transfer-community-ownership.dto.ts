import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TransferCommunityOwnershipDto {
  @ApiProperty({
    description: 'ID del perfil que será el nuevo owner',
    example: 123,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  profileId!: number;
}
