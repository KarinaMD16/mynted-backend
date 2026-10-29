import { Transform } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trimRequired = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeOptional = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
};

const normalizeCountry = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ShippingAddressDto {
  @ApiProperty({ example: 'María López', minLength: 2, maxLength: 120 })
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty({ example: '88888888', minLength: 3, maxLength: 30 })
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @Length(3, 30)
  phone!: string;

  @ApiProperty({ example: 'CR', minLength: 2, maxLength: 2 })
  @Transform(normalizeCountry)
  @IsString()
  @IsISO31661Alpha2()
  country!: string;

  @ApiProperty({ example: 'San José', minLength: 1, maxLength: 100 })
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  province!: string;

  @ApiProperty({ example: 'San José', minLength: 1, maxLength: 100 })
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  city!: string;

  @ApiProperty({ example: 'Avenida Central', minLength: 1, maxLength: 200 })
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  line1!: string;

  @ApiPropertyOptional({ example: null, nullable: true, maxLength: 200 })
  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  @Length(1, 200)
  line2!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true, maxLength: 30 })
  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  @Length(1, 30)
  postalCode!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true, maxLength: 500 })
  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  @Length(1, 500)
  notes!: string | null;
}
