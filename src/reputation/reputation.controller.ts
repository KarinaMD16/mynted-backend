import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserReputationDto } from './dto/user-reputation.dto';
import { ReputationService } from './reputation.service';

// Público (sin sesión): la reputación se muestra a visitantes junto a los
// productos y sus reseñas, que también son públicos.
@ApiTags('profiles')
@Controller('profiles')
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  @Get(':perfilId/reputation')
  @ApiOperation({
    summary:
      'Reputación pública de un usuario: promedio y total de reseñas de sus productos, distribución por estrellas, ventas completadas y badges',
  })
  @ApiParam({
    name: 'perfilId',
    format: 'uuid',
    description: 'id del usuario (User.id)',
  })
  @ApiResponse({ status: 200, type: UserReputationDto })
  @ApiResponse({ status: 400, description: 'perfilId no es un uuid válido' })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado o desactivado',
  })
  getReputation(
    @Param('perfilId', ParseUUIDPipe) perfilId: string,
  ): Promise<UserReputationDto> {
    return this.reputationService.getUserReputation(perfilId);
  }
}
