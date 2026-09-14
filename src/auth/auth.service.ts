import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { User } from '../users/entities/user.entity';
import { OAuthProvider } from '../users/entities/user-oauth-account.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { GoogleAuthService } from './social/google-auth.service';
import { FacebookAuthService } from './social/facebook-auth.service';
import { SocialProfile } from './social/social-profile.interface';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const RESET_TOKEN_BYTES = 32;
const DEFAULT_RESET_TOKEN_EXPIRES_IN_MINUTES = 60;
const DEFAULT_REFRESH_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // 7 días

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly facebookAuthService: FacebookAuthService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailOrUsername(dto.identifier);
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Esta cuenta inició sesión con Google o Facebook. Usa esa opción para acceder',
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return this.buildSession(user);
  }

  async loginWithGoogle(idToken: string) {
    const profile = await this.googleAuthService.verifyIdToken(idToken);
    const { user, isNewUser } = await this.linkOrCreateSocialUser(
      'google',
      profile,
    );
    return { ...this.buildSession(user), isNewUser };
  }

  async loginWithFacebook(accessToken: string) {
    const profile =
      await this.facebookAuthService.verifyAccessToken(accessToken);
    const { user, isNewUser } = await this.linkOrCreateSocialUser(
      'facebook',
      profile,
    );
    return { ...this.buildSession(user), isNewUser };
  }

  /**
   * Une el flujo de las 3 vías de acceso: cuenta ya vinculada a ese proveedor,
   * cuenta existente con el mismo correo (se vincula) o cuenta nueva.
   * isNewUser solo es true en el tercer caso, y es lo que le indica al
   * frontend si debe disparar el onboarding completo (tags + comunidades).
   */
  private async linkOrCreateSocialUser(
    provider: OAuthProvider,
    profile: SocialProfile,
  ): Promise<{ user: User; isNewUser: boolean }> {
    const existingLink = await this.usersService.findByOAuthAccount(
      provider,
      profile.providerUserId,
    );
    if (existingLink) {
      return { user: existingLink, isNewUser: false };
    }

    const existingByEmail = await this.usersService.findByEmail(profile.email);
    if (existingByEmail) {
      await this.usersService.linkOAuthAccount(
        existingByEmail.id,
        provider,
        profile.providerUserId,
      );
      return { user: existingByEmail, isNewUser: false };
    }

    const newUser = await this.usersService.createFromOAuth({
      email: profile.email,
      name: profile.name,
      photoUrl: profile.photoUrl,
    });
    await this.usersService.linkOAuthAccount(
      newUser.id,
      provider,
      profile.providerUserId,
    );
    return { user: newUser, isNewUser: true };
  }

  /**
   * Emite un access_token (corto, payload {sub, email}) y un refresh_token
   * (largo, payload {sub}, firmado con JWT_REFRESH_SECRET). JWT sin estado:
   * no se persiste el refresh token en BD, solo se firma/valida.
   */
  private buildSession(user: User) {
    const payload = { sub: user.id, email: user.email };
    const accessToken = this.jwtService.sign(payload);

    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.getRefreshExpiresInSeconds(),
      },
    );

    return { accessToken, refreshToken, user };
  }

  /**
   * POST /auth/refresh: el refresh_token ya fue validado por JwtRefreshGuard
   * antes de llegar aquí. Reemitimos ambos tokens (rotación simple del
   * refresh token en cada uso).
   */
  async refreshSession(userId: string) {
    const user = await this.usersService.findById(userId).catch(() => null);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sesión inválida');
    }

    return this.buildSession(user);
  }

  private getRefreshExpiresInSeconds(): number {
    return parseInt(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN_SECONDS') ??
        String(DEFAULT_REFRESH_EXPIRES_IN_SECONDS),
      10,
    );
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      return;
    }

    const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const expiresInMinutes = parseInt(
      this.configService.get<string>('RESET_TOKEN_EXPIRES_IN_MINUTES') ??
        String(DEFAULT_RESET_TOKEN_EXPIRES_IN_MINUTES),
      10,
    );
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await this.usersService.setPasswordResetToken(
      user.id,
      tokenHash,
      expiresAt,
    );

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

    await this.mailService.sendPasswordResetEmail(user.email, resetLink);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);
    const user = await this.usersService.findByResetTokenHash(tokenHash);

    if (
      !user ||
      !user.resetPasswordExpiresAt ||
      user.resetPasswordExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'El enlace de recuperación es inválido o ha expirado',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.updatePassword(user.id, passwordHash);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findById(userId);

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Esta cuenta inició sesión con Google/Facebook y no tiene contraseña. Usa "Recuperar contraseña" para crear una',
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.updatePassword(user.id, passwordHash);
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
