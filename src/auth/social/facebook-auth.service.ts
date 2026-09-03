import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialProfile } from './social-profile.interface';

interface DebugTokenResponse {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    user_id?: string;
    error?: { message?: string };
  };
}

interface FacebookProfileResponse {
  id?: string;
  name?: string;
  email?: string;
  error?: { message?: string };
}

@Injectable()
export class FacebookAuthService {
  private readonly appId: string | undefined;
  private readonly appSecret: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.appId = this.configService.get<string>('FACEBOOK_APP_ID');
    this.appSecret = this.configService.get<string>('FACEBOOK_APP_SECRET');
  }

  async verifyAccessToken(accessToken: string): Promise<SocialProfile> {
    if (!this.appId || !this.appSecret) {
      throw new UnauthorizedException(
        'Login con Facebook no está configurado en el servidor',
      );
    }

    const appAccessToken = `${this.appId}|${this.appSecret}`;

    const debugRes = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`,
    );
    const debug = (await debugRes.json()) as DebugTokenResponse;

    if (
      !debug.data?.is_valid ||
      debug.data.app_id !== this.appId ||
      !debug.data.user_id
    ) {
      throw new UnauthorizedException('Token de Facebook inválido');
    }

    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`,
    );
    const profile = (await profileRes.json()) as FacebookProfileResponse;

    if (!profile.id || profile.error) {
      throw new UnauthorizedException(
        'No se pudo obtener el perfil de Facebook',
      );
    }

    if (!profile.email) {
      throw new UnauthorizedException(
        'Tu cuenta de Facebook no tiene un correo asociado. Usa otro método de acceso o autoriza el permiso de correo',
      );
    }

    return {
      providerUserId: profile.id,
      email: profile.email,
      name: profile.name,
    };
  }
}
