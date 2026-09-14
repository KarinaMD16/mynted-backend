import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserCommunitiesService } from './user-communities.service';
import { JoinCommunitiesDto } from './dto/join-communities.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';

@ApiTags('user-communities')
@Controller('users/me/communities')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserCommunitiesController {
  constructor(
    private readonly userCommunitiesService: UserCommunitiesService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Unirse a las comunidades recomendadas en el onboarding (0 para omitir). ' +
      'Crea un communityProfile con rol member por cada una; no duplica si ya pertenece.',
  })
  joinCommunities(
    @Req() req: AuthenticatedRequest,
    @Body() dto: JoinCommunitiesDto,
  ) {
    return this.userCommunitiesService.joinCommunities(
      req.user.userId,
      dto.communityIds,
    );
  }
}
