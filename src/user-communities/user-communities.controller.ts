import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserCommunitiesService } from './user-communities.service';
import { JoinCommunitiesDto } from './dto/join-communities.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { GetCommunitiesQueryDto } from '../community/dto/get-communities-query.dto';
import { GetOnboardingRecommendedCommunitiesQueryDto } from './dto/get-onboarding-recommended-communities-query.dto';

@ApiTags('user-communities')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserCommunitiesController {
  constructor(
    private readonly userCommunitiesService: UserCommunitiesService,
  ) {}

  @Get('communities')
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

  @Get('recommended-communities')
  @ApiOperation({
    summary: 'Obtener comunidades recomendadas para el usuario autenticado',
  })
  findRecommended(
    @Req() req: AuthenticatedRequest,
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: GetCommunitiesQueryDto,
  ) {
    return this.userCommunitiesService.findRecommendedCommunities(
      req.user.userId,
      query,
    );
  }

  @Get('communities/recommended')
  @ApiOperation({
    summary:
      'Comunidades recomendadas para el onboarding, por coincidencia simple ' +
      'de tags con los intereses del usuario (paso previo a POST /users/me/communities)',
  })
  findOnboardingRecommended(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetOnboardingRecommendedCommunitiesQueryDto,
  ) {
    return this.userCommunitiesService.findOnboardingRecommendedCommunities(
      req.user.userId,
      query,
    );
  }

  @Post('communities')
  @ApiOperation({
    summary:
      'Unirse a las comunidades recomendadas en el onboarding (0 para omitir). ' +
      'Por cada una: si es pública crea un communityProfile (member); si es privada crea ' +
      'una solicitud pendiente. No duplica si ya es miembro o ya tiene una solicitud pendiente.',
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
