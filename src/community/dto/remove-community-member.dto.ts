import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RemoveCommunityMemberDto {
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
