import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { Order, OrderHistory } from './entities';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'order-service' }),
    TypeOrmModule.forRoot(typeOrmConfig()),
    TypeOrmModule.forFeature([Order, OrderHistory]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class AppModule {}
