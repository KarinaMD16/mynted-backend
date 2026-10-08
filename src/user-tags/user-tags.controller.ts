import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from '../users/users.service';
import { UserTagsService } from './user-tags.service';
import { SaveUserTagsDto } from './dto/save-user-tags.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';

@ApiTags('user-tags')
@Controller('users/me/tags')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserTagsController {
  constructor(private readonly userTagsService: UserTagsService) {}

  @Get()
  @ApiOperation({
    summary: 'Tags de interés seleccionados por el usuario actual',
  })
  getMine(@Req() req: AuthenticatedRequest) {
    return this.userTagsService.getUserTags(req.user.userId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Guardar los intereses elegidos en el onboarding (0 para omitir, o mínimo 3 tags principales; reemplaza la selección anterior). ' +
      'También guarda la aceptación de política de privacidad y, si se envían, locale/currency del navegador.',
  })
  setMine(@Req() req: AuthenticatedRequest, @Body() dto: SaveUserTagsDto) {
    return this.userTagsService.setUserTags(req.user.userId, dto);
  }
}

// Debe registrarse después de UserTagsController: 'users/me/tags' tiene que
// resolverse antes que 'users/:id/tags'.
@ApiTags('user-tags')
@Controller('users/:id/tags')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PublicUserTagsController {
  constructor(
    private readonly userTagsService: UserTagsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Tags de interés de un usuario (perfil público)' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.findPublicById(id);
    return this.userTagsService.getUserTags(id);
  }
}
