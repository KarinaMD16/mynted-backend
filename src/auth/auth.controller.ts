import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { FacebookLoginDto } from './dto/facebook-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import {
  AuthenticatedRequest,
  RefreshAuthenticatedRequest,
} from './types/authenticated-request';
import { setAuthCookies } from './auth-cookies.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Login de usuario (con email o username)' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, ...tokens } = await this.authService.login(dto);
    setAuthCookies(res, tokens, this.configService);
    return { user: this.toSafeUser(user) };
  }

  @Post('google')
  @ApiOperation({
    summary:
      'Login/registro con Google. isNewUser indica si se creó la cuenta ahora (dispara el onboarding)',
  })
  async loginWithGoogle(
    @Body() dto: GoogleLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, isNewUser, ...tokens } =
      await this.authService.loginWithGoogle(dto.idToken);
    setAuthCookies(res, tokens, this.configService);
    return { user: this.toSafeUser(user), isNewUser };
  }

  @Post('facebook')
  @ApiOperation({
    summary:
      'Login/registro con Facebook. isNewUser indica si se creó la cuenta ahora (dispara el onboarding)',
  })
  async loginWithFacebook(
    @Body() dto: FacebookLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, isNewUser, ...tokens } =
      await this.authService.loginWithFacebook(dto.accessToken);
    setAuthCookies(res, tokens, this.configService);
    return { user: this.toSafeUser(user), isNewUser };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Renovar el access_token usando el refresh_token (rota ambos). 401 si el refresh_token es inválido o expiró',
  })
  async refresh(
    @Req() req: RefreshAuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, ...tokens } = await this.authService.refreshSession(
      req.user.userId,
    );
    setAuthCookies(res, tokens, this.configService);
    return { user: this.toSafeUser(user) };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Cerrar sesión' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    return { message: 'Sesión cerrada' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar enlace de recuperación de contraseña' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return {
      message:
        'Si el correo está registrado, se ha enviado un enlace de recuperación',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restablecer contraseña con token de recuperación' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Contraseña actualizada correctamente' };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar contraseña estando autenticado' })
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(req.user.userId, dto);
    return { message: 'Contraseña actualizada correctamente' };
  }

  @Post('request-email-change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Solicitar cambio de email estando autenticado. Envía un enlace de confirmación al nuevo correo',
  })
  async requestEmailChange(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RequestEmailChangeDto,
  ) {
    await this.authService.requestEmailChange(req.user.userId, dto);
    return {
      message: 'Se ha enviado un enlace de confirmación al nuevo correo',
    };
  }

  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirmar el cambio de email con el token recibido en el nuevo correo',
  })
  async confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    await this.authService.confirmEmailChange(dto);
    return { message: 'Email actualizado correctamente' };
  }

  private toSafeUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      photoUrl: user.photoUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
