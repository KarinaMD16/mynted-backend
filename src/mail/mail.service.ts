import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<string>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    this.from =
      this.configService.get<string>('SMTP_FROM') ?? 'no-reply@mynted.com';

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: { user, pass },
      });
    } else {
      this.transporter = null;
      this.logger.warn(
        'SMTP no configurado (SMTP_HOST/PORT/USER/PASS). Los correos se mostrarán en la consola en su lugar.',
      );
    }
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    const subject = 'Recupera tu contraseña de Mynted';
    const html = `
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${resetLink}">Haz clic aquí para crear una nueva contraseña</a></p>
      <p>Si no solicitaste esto, puedes ignorar este correo.</p>
      <p>Este enlace expira en un tiempo limitado por seguridad.</p>
    `;

    if (!this.transporter) {
      this.logger.log(
        `[DEV] Enlace de recuperación de contraseña para ${to}: ${resetLink}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      html,
    });
  }
}
