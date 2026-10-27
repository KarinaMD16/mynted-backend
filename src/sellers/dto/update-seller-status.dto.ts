import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SellerRequestStatus } from '../../users/entities/user.entity';

type SellerDecision =
  | SellerRequestStatus.APPROVED
  | SellerRequestStatus.REJECTED
  | SellerRequestStatus.REVOKED;

export class UpdateSellerStatusDto {
  @ApiProperty({
    enum: [
      SellerRequestStatus.APPROVED,
      SellerRequestStatus.REJECTED,
      SellerRequestStatus.REVOKED,
    ],
    example: SellerRequestStatus.APPROVED,
  })
  @IsIn(
    [
      SellerRequestStatus.APPROVED,
      SellerRequestStatus.REJECTED,
      SellerRequestStatus.REVOKED,
    ],
    {
      message: 'status debe ser approved, rejected o revoked',
    },
  )
  status!: SellerDecision;

  @ApiPropertyOptional({
    description: 'Motivo obligatorio únicamente al revocar',
    maxLength: 500,
    example: 'Incumplimiento de las políticas de venta',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf(
    (dto: UpdateSellerStatusDto) =>
      dto.status === SellerRequestStatus.REVOKED || dto.reason !== undefined,
  )
  @IsString({ message: 'reason debe ser un texto' })
  @MaxLength(500, { message: 'reason no puede superar 500 caracteres' })
  @IsNotEmpty({ message: 'reason es obligatorio al revocar un vendedor' })
  reason?: string;
}
