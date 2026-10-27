import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  Inject,
  Param,
  Query,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PublicUserDto } from './dto/public-user.dto';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { User, UserRole } from './entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { AuthService } from '../auth/auth.service';
import { setAuthCookies } from '../auth/auth-cookies.util';
import { DeactivateUserDto } from './dto/deactivate-user.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Registrar un nuevo usuario. Inicia sesión automáticamente (setea access_token/refresh_token)',
  })
  async create(
    @Body() dto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.usersService.create(dto);
    const { accessToken, refreshToken } = this.authService.buildSession(user);
    setAuthCookies(res, { accessToken, refreshToken }, this.configService);
    return user;
  }

  @Get()
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Superadmin] Obtener todos los usuarios' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Obtener el perfil del usuario autenticado. Si es vendedor aprobado trae además seller { sellerId, displayName, isVerified, ratingAverage, reviewsCount, responseTime }',
  })
  findMe(@Req() request: AuthenticatedRequest) {
    return this.usersService.findMe(request.user.userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Actualizar el perfil del usuario autenticado (username, bio, location, locale, currency, displayCurrency, ' +
      'país, preferencias de notificación, confirmUnfavorite y/o foto)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        username: { type: 'string', example: 'nuevo_username' },
        bio: {
          type: 'string',
          example: 'Coleccionista de Funko Pop desde 2015',
        },
        location: { type: 'string', example: 'San José, Costa Rica' },
        locale: {
          type: 'string',
          example: 'es-CR',
          description: 'Etiqueta BCP 47',
        },
        currency: {
          type: 'string',
          example: 'CRC',
          description:
            'Moneda de venta y comisión (ISO 4217). No cambia cómo se muestran los precios',
        },
        displayCurrency: {
          type: 'string',
          example: 'USD',
          description:
            'Moneda en la que ver los precios (ISO 4217 soportado; solo visualización)',
        },
        country: {
          type: 'string',
          example: 'CR',
          description: 'ISO 3166-1 alfa-2',
        },
        confirmUnfavorite: { type: 'boolean', example: true },
        emailNotifications: { type: 'boolean', example: true },
        pushNotifications: { type: 'boolean', example: true },
        photo: {
          type: 'string',
          format: 'binary',
          description:
            'Nueva foto de perfil (JPEG, PNG, WEBP o GIF; máximo 5 MB)',
        },
      },
    },
  })
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    dto: UpdateProfileDto,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return this.usersService.updateProfile(request.user.userId, dto, photo);
  }

  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Superadmin] Desactivar un usuario' })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiForbiddenResponse({ description: 'Operación no permitida' })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'uuid',
        username: 'usuario',
        role: 'user',
        isActive: false,
      },
    },
  })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: DeactivateUserDto,
  ) {
    return this.toStatusUser(
      this.usersService.deactivate(id, request.user.userId, dto.reason),
    );
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Superadmin] Activar un usuario' })
  @ApiForbiddenResponse({ description: 'Operación no permitida' })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'uuid',
        username: 'usuario',
        role: 'user',
        isActive: true,
      },
    },
  })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.toStatusUser(
      this.usersService.activate(id, request.user.userId),
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Superadmin] Eliminar lógicamente un usuario' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          maxLength: 500,
          example: 'Incumplimiento grave de normas',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Motivo inválido' })
  @ApiForbiddenResponse({ description: 'Operación no permitida' })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiUnauthorizedResponse({ description: 'Se requiere autenticación' })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'uuid',
        username: 'usuario',
        role: 'user',
        isActive: false,
        deletedAt: '2026-10-27T04:00:00.000Z',
      },
    },
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: DeactivateUserDto,
  ) {
    return this.toDeletedUser(
      this.usersService.softDelete(id, request.user.userId, dto.reason),
    );
  }

  private async toStatusUser(userPromise: Promise<User>) {
    const user = await userPromise;
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
    };
  }

  private async toDeletedUser(userPromise: Promise<User>) {
    const user = await userPromise;
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      deletedAt: user.deletedAt,
    };
  }

  // Las rutas literales (search, by-username) van antes de ':id'.
  @Get('search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Buscar usuarios activos por username (contiene, sin distinguir mayúsculas). Solo datos públicos',
  })
  search(@Query() query: SearchUsersQueryDto) {
    return this.usersService.searchPublic(query);
  }

  @Get('by-username/:username')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener el perfil público de un usuario por username',
  })
  @ApiOkResponse({ type: PublicUserDto })
  findByUsername(@Param('username') username: string) {
    return this.usersService.findPublicByUsername(username);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Obtener el perfil público de un usuario por id (un superadmin recibe la respuesta completa)',
  })
  @ApiOkResponse({ type: PublicUserDto })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const requester = await this.usersService.findById(request.user.userId);
    if (requester.role === UserRole.SUPERADMIN) {
      return this.usersService.findById(id);
    }
    return this.usersService.findPublicById(id);
  }
}
