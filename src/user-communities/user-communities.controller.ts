import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserCommunitiesService } from './user-communities.service';
import { JoinCommunitiesDto } from './dto/join-communities.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { GetCommunitiesQueryDto } from '../community/dto/get-communities-query.dto';

@ApiTags('user-communities')
@Controller('users/me/communities')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserCommunitiesController {
  constructor(
    private readonly userCommunitiesService: UserCommunitiesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las comunidades del usuario autenticado',
  })
  findMine(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetCommunitiesQueryDto,
  ) {
    return this.userCommunitiesService.findMyCommunities(
      req.user.userId,
      query,
    );
  }

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
