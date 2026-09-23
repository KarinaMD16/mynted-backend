import {
  Body,
  Controller,
  forwardRef,
  Get,
  Inject,
  Param,
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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { AuthService } from '../auth/auth.service';
import { setAuthCookies } from '../auth/auth-cookies.util';

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
  @ApiOperation({ summary: 'Obtener el perfil del usuario autenticado' })
  findMe(@Req() request: AuthenticatedRequest) {
    return this.usersService.findById(request.user.userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Actualizar el perfil del usuario autenticado (username, bio, location, locale, currency, ' +
      'preferencias de notificación y/o foto)',
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
        locale: { type: 'string', example: 'es-CR' },
        currency: { type: 'string', example: 'CRC' },
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
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.deactivate(id, request.user.userId);
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Superadmin] Activar un usuario' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.activate(id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener un usuario por id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }
}
