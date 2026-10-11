import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig, OUTBOX_ENTITIES } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { Machine, WorkOrder } from './entities';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'production-service' }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([Machine, WorkOrder, ...OUTBOX_ENTITIES]),
  ],
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class AppModule {}
