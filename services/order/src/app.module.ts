import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { Order, OrderHistory } from './entities';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'order-service' }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([Order, OrderHistory]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class AppModule {}
