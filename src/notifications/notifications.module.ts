import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsListener } from './notifications.listener';
import { NotificationsRetentionService } from './notifications-retention.service';
import { NotificationsService } from './notifications.service';

// No importa los módulos que emiten eventos: los escucha por EventEmitter2,
// así que ninguno depende de este.
@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    NotificationsListener,
    NotificationsRetentionService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
