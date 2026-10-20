import { Transform, TransformFnParams } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_CURRENCIES } from '../exchange-rate/exchange-rate.constants';

export class CommissionTiersQueryDto {
  @ApiProperty({ example: 'CRC', minLength: 3, maxLength: 3 })
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  @IsIn(SUPPORTED_CURRENCIES, {
    message: 'La moneda no está soportada por Mynted',
  })
  currency!: string;
}
