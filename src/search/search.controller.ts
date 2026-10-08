import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { OptionalAuthenticatedRequest } from '../auth/types/authenticated-request';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Búsqueda global. Con type devuelve resultados paginados de ese tipo (users, posts, products, communities; forums es alias de posts); ' +
      'sin type, un resumen con los primeros 5 de cada tipo. Solo cuentas activas, comunidades públicas y productos activos y visibles',
  })
  search(
    @Query() query: SearchQueryDto,
    @Req() request: OptionalAuthenticatedRequest,
  ) {
    return this.searchService.search(query, request.user?.userId);
  }
}
