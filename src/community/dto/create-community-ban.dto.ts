import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommunityBanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'Incumplimiento de reglas', maxLength: 500 })
  @Transform(({ value }: TransformFnParams) => {
    return typeof value === 'string' ? value.trim() : (value as unknown);
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
