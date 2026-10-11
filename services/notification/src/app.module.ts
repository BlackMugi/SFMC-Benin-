import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { Notification, OrderContact } from './entities';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationProvider, createProvider } from './providers';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'notification-service' }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([Notification, OrderContact]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, { provide: NotificationProvider, useFactory: createProvider }],
})
export class AppModule {}
