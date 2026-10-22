import { Module } from '@nestjs/common';
import { ResponseTimeService } from './response-time.service';

// Sin dependencias de otros módulos (solo DataSource) para que UsersModule y
// la tienda pública puedan importarlo sin ciclos.
@Module({
  providers: [ResponseTimeService],
  exports: [ResponseTimeService],
})
export class ResponseTimeModule {}
