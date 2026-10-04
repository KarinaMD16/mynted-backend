import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VoteType } from '../entities/vote-type.enum';

export class VoteDto {
  @ApiProperty({ enum: VoteType, example: VoteType.UP })
  @IsEnum(VoteType)
  voteType!: VoteType;
}
