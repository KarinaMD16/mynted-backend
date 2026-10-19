import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AdminCommissionTiersService } from './admin-commission-tiers.service';
import { CreateCommissionTierDto } from './dto/admin-commission-tier-create.dto';
import { UpdateCommissionTierDto } from './dto/admin-commission-tier-update.dto';
import { AdminCommissionTierQueryDto } from './dto/admin-commission-tier-query.dto';
import { AdminCommissionTierResponseDto } from './dto/admin-commission-tier-response.dto';

@ApiTags('admin/commission-tiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/commission-tiers')
export class AdminCommissionTiersController {
  constructor(private readonly service: AdminCommissionTiersService) {}

  @Get()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'currency', required: false, example: 'CRC' })
  @ApiOkResponse({ type: [AdminCommissionTierResponseDto] })
  @ApiOperation({ summary: 'Listar tiers de comisión administrativos' })
  findAll(@Query() query: AdminCommissionTierQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: AdminCommissionTierResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiCreatedResponse({ type: AdminCommissionTierResponseDto })
  @ApiOperation({ summary: 'Crear tier de comisión' })
  create(@Body() dto: CreateCommissionTierDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: AdminCommissionTierResponseDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommissionTierDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: AdminCommissionTierResponseDto })
  @ApiOperation({ summary: 'Desactivar tier de comisión' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
