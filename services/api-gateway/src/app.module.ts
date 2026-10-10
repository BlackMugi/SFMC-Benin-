import { Module } from '@nestjs/common';
import { CommonModule } from '@sfmc/common';

/** La gateway n'a ni base ni événements : routage, sécurité et observabilité uniquement. */
@Module({
  imports: [CommonModule.forRoot({ serviceName: 'api-gateway', events: false })],
})
export class AppModule {}
