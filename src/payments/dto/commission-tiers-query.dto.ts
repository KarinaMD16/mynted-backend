import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CommissionTiersQueryDto {
  @ApiProperty({ example: 'CRC', minLength: 3, maxLength: 3 })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currency!: string;
}
