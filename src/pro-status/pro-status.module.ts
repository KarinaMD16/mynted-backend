import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { ProStatusService } from './pro-status.service';

// Módulo hoja, como ResponseTimeModule: solo usa DataSource (SQL directo), así
// que Users, Badges, Products, Conversations y el resto pueden importarlo sin
// ciclos. forFeature solo registra la entidad para que la tabla exista donde
// esté este módulo.
@Module({
  imports: [TypeOrmModule.forFeature([Subscription])],
  providers: [ProStatusService],
  exports: [ProStatusService],
})
export class ProStatusModule {}
