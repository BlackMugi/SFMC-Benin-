import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '@sfmc/common';
import { ReportingService } from './reporting.service';

@ApiTags('reports')
@ApiBearerAuth()
@Roles(Role.Admin, Role.Operator)
@Controller('reports')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Synthèse ventes / stocks / production / compteurs d\'événements' })
  summary() {
    return this.reporting.summary();
  }

  @Get('sales')
  @ApiOperation({ summary: 'Ventes (CA, par produit, par jour). Filtres from/to au format YYYY-MM-DD' })
  sales(@Query('from') from?: string, @Query('to') to?: string) {
    const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    return this.reporting.salesReport(ok(from), ok(to));
  }

  @Get('stock')
  stock() {
    return this.reporting.stockReport();
  }

  @Get('production')
  production() {
    return this.reporting.productionReport();
  }

  @Get('orders/:id/timeline')
  @ApiOperation({ summary: 'Chronologie complète des événements d\'une commande' })
  timeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.reporting.orderTimeline(id);
  }

  @Get('events')
  events(@Query('type') type?: string, @Query('limit') limit?: string) {
    return this.reporting.recentEvents(type, limit ? parseInt(limit, 10) || 100 : 100);
  }
}
