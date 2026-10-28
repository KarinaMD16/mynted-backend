import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

// Cada campo es opcional: solo se cambia lo que se envía. null deja ese tipo
// en su valor por defecto.
export class EquipCosmeticsDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 3,
    description:
      'id de un cosmético de tipo banner (GET /cosmetics). null = banner por defecto. Elegir uno del catálogo desactiva el banner propio salvo que envíes useCustomBanner',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  bannerId?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 7,
    description: 'id de un cosmético de tipo goose_skin. null = por defecto',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  gooseSkinId?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 11,
    description: 'id de un cosmético de tipo frame. null = por defecto',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  frameId?: number | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'Usar el banner propio en lugar del del catálogo. Requiere Pro y haber subido uno (PUT /users/me/banner)',
  })
  @IsOptional()
  @IsBoolean()
  useCustomBanner?: boolean;
}
