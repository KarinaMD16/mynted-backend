import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
      'Guardar los intereses elegidos en el onboarding (mínimo 3 tags principales, reemplaza la selección anterior)',
  })
  setMine(@Req() req: AuthenticatedRequest, @Body() dto: SaveUserTagsDto) {
    return this.userTagsService.setUserTags(req.user.userId, dto.tagIds);
  }
}
