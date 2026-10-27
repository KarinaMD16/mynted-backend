import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const trimReason = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class DeleteCommunityDto {
  @ApiProperty({
    example: 'Incumplimiento de políticas',
    maxLength: 500,
  })
  @Transform(trimReason)
  @IsString({ message: 'reason debe ser un texto' })
  @IsNotEmpty({ message: 'reason es obligatorio' })
  @MaxLength(500, { message: 'reason no puede superar 500 caracteres' })
  reason!: string;
}
