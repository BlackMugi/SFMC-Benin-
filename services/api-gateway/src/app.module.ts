import { Module } from '@nestjs/common';
import { CommonModule } from '@sfmc/common';

/** Pas de base ni d'événements : routage, sécurité et observabilité. */
@Module({
  imports: [CommonModule.forRoot({ serviceName: 'api-gateway', events: false })],
})
export class AppModule {}
