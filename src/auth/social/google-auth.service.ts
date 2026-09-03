import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginTicket, OAuth2Client } from 'google-auth-library';
import { SocialProfile } from './social-profile.interface';

@Injectable()
export class GoogleAuthService {
  private readonly client: OAuth2Client;
  private readonly clientId: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    this.client = new OAuth2Client(this.clientId);
  }

  async verifyIdToken(idToken: string): Promise<SocialProfile> {
    if (!this.clientId) {
      throw new UnauthorizedException(
        'Login con Google no está configurado en el servidor',
      );
    }

    let ticket: LoginTicket;
    try {
      ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
    } catch {
      throw new UnauthorizedException('Token de Google inválido');
    }

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Token de Google inválido');
    }

    return {
      providerUserId: payload.sub,
      email: payload.email,
      name: payload.name,
      photoUrl: payload.picture,
    };
  }
}
