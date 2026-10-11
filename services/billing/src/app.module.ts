import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig, OUTBOX_ENTITIES } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Invoice } from './invoice.entity';
import { MockPaymentProvider, PaymentProvider } from './payment.provider';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'billing-service' }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([Invoice, ...OUTBOX_ENTITIES]),
  ],
  controllers: [BillingController],
  // Remplacer MockPaymentProvider par une implémentation réelle (Mobile Money, carte...)
  providers: [BillingService, { provide: PaymentProvider, useClass: MockPaymentProvider }],
})
export class AppModule {}
