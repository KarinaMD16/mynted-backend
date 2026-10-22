import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Avisos por producto favorito (tarea 1044). Solo aplican a productos.
export class FavoriteNotificationsDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Avisar cuando cambie el precio final (con descuento)',
  })
  @IsOptional()
  @IsBoolean({ message: 'notifyPrice debe ser un booleano' })
  notifyPrice?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Avisar cuando deje de estar disponible (vendido, pausado, oculto o borrado) o vuelva a estarlo',
  })
  @IsOptional()
  @IsBoolean({ message: 'notifyAvailability debe ser un booleano' })
  notifyAvailability?: boolean;
}
