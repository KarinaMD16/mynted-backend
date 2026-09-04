import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InterestsService } from './interests.service';
import { SaveInterestsDto } from './dto/save-interests.dto';
import { CreateInterestDto } from './dto/create-interest.dto';
import { UpdateInterestDto } from './dto/update-interest.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';

@ApiTags('interests')
@Controller('interests')
export class InterestsController {
  constructor(private readonly interestsService: InterestsService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de intereses/franquicias disponibles' })
  findAll() {
    return this.interestsService.findAll();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Intereses seleccionados por el usuario actual' })
  getMine(@Req() req: AuthenticatedRequest) {
    return this.interestsService.getUserInterests(req.user.userId);
  }

  @Post('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Guardar los intereses elegidos en el onboarding (mínimo 3, reemplaza la selección anterior)',
  })
  setMine(@Req() req: AuthenticatedRequest, @Body() dto: SaveInterestsDto) {
    return this.interestsService.setUserInterests(
      req.user.userId,
      dto.interestIds,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un interés por id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.interestsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Superadmin] Crear un interés' })
  create(@Body() dto: CreateInterestDto) {
    return this.interestsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Superadmin] Editar un interés' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInterestDto,
  ) {
    return this.interestsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[Superadmin] Eliminar un interés' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.interestsService.remove(id);
  }
}
