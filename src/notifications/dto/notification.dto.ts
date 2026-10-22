import { Transform, TransformFnParams, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { parseBoolean } from '../../community/dto/create-community.dto';
import { NotificationType } from '../enums/notification-type.enum';

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: NotificationType,
    example: NotificationType.FAVORITE_PRICE_CHANGED,
  })
  type!: NotificationType;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      productId: 22,
      productTitle: 'Funko Pop Goku SSJ',
      previousPrice: 25000,
      newPrice: 22500,
      currency: 'CRC',
    },
    description: 'Depende de type (ver docs/GUIA_NOTIFICACIONES_FRONTEND.md)',
  })
  data!: Record<string, unknown>;

  @ApiProperty({
    example: 'Cambió el precio de "Funko Pop Goku SSJ"',
    description: 'Texto de respaldo en español; el front arma el suyo',
  })
  message!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class NotificationListQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true: solo las no leídas',
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseBoolean(value as unknown))
  @IsBoolean({ message: 'unread debe ser true o false' })
  unread?: boolean;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  unreadCount!: number;
}

export class MarkAllReadDto {
  @ApiProperty({ example: 3, description: 'Cuántas se marcaron' })
  updated!: number;

  @ApiProperty({ example: 0 })
  unreadCount!: number;
}
