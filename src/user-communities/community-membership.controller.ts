import {
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserCommunitiesService } from './user-communities.service';

@ApiTags('community-membership')
@Controller('communities')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CommunityMembershipController {
  constructor(
    private readonly userCommunitiesService: UserCommunitiesService,
  ) {}

  @Post(':id/join')
  @ApiOperation({ summary: 'Unirse a una comunidad' })
  join(
    @Param('id', ParseIntPipe) communityId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.userCommunitiesService.joinCommunity(
      request.user.userId,
      communityId,
    );
  }

  @Delete(':id/leave')
  @ApiOperation({ summary: 'Abandonar una comunidad' })
  leave(
    @Param('id', ParseIntPipe) communityId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.userCommunitiesService.leaveCommunity(
      request.user.userId,
      communityId,
    );
  }
}
