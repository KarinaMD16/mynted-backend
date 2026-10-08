import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { BadgesService } from './badges.service';

@ApiTags('badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BadgesController {
  constructor(
    private readonly badgesService: BadgesService,
    private readonly usersService: UsersService,
  ) {}

  @Get('users/:id/badges')
  @ApiOperation({
    summary:
      'Badges de un usuario (con awardedAt, rarity e ícono), del más reciente al más antiguo',
  })
  async findUserBadges(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.findPublicById(id);
    return this.badgesService.findUserBadges(id);
  }

  @Get('community-profiles/:id/badges')
  @ApiOperation({
    summary:
      'Badges de un perfil de comunidad (fundador, moderador, miembro fundador, voz de la comunidad)',
  })
  findProfileBadges(@Param('id', ParseIntPipe) id: number) {
    return this.badgesService.findProfileBadges(id);
  }
}
