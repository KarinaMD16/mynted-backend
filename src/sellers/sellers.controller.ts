import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellersService } from './sellers.service';
import { RequestSellerDto } from './dto/request-seller.dto';
import { UpdateSellerStatusDto } from './dto/update-seller-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';

@ApiTags('sellers')
@Controller('users')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post('me/request-seller')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Solicitar convertirse en vendedor (crea seller/paymentInfo, deja sellerRequestStatus en pending)',
  })
  requestSeller(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RequestSellerDto,
  ) {
    return this.sellersService.requestSeller(req.user.userId, dto);
  }

  @Patch(':id/seller-status')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      '[Superadmin] Aprobar o rechazar una solicitud de vendedor pendiente',
  })
  updateSellerStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSellerStatusDto,
  ) {
    return this.sellersService.updateSellerStatus(id, dto);
  }
}
