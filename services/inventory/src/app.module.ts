import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { Reservation, Stock, StockMovement, Warehouse } from './entities';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'inventory-service' }),
    TypeOrmModule.forRoot(typeOrmConfig()),
    TypeOrmModule.forFeature([Warehouse, Stock, StockMovement, Reservation]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class AppModule {}
