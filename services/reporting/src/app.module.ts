import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { EventLog, ProductionStat, SaleLine, StockSnapshot } from './entities';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'reporting-service' }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([EventLog, SaleLine, StockSnapshot, ProductionStat]),
  ],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class AppModule {}
