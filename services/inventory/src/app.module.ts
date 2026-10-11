import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { Reservation, Stock, StockMovement, Warehouse } from './entities';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'inventory-service' }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([Warehouse, Stock, StockMovement, Reservation]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class AppModule {}
