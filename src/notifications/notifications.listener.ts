import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * Traduce eventos de dominio (EventEmitter2) en notificaciones. Los
 * handlers son asíncronos ({ async: true }) y van envueltos en safely():
 * igual que en BadgesListener, un fallo se loguea y nunca rompe la request
 * que emitió el evento.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  async safely(event: string, handler: () => Promise<unknown>): Promise<void> {
    try {
      await handler();
    } catch (error: unknown) {
      this.logger.error(
        `Error generando notificaciones para el evento ${event}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
