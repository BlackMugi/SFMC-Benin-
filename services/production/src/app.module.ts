import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { Machine, WorkOrder } from './entities';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'production-service' }),
    TypeOrmModule.forRoot(typeOrmConfig()),
    TypeOrmModule.forFeature([Machine, WorkOrder]),
  ],
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class AppModule {}
