import { Body, Controller, Get, MessageEvent, Param, ParseUUIDPipe, Patch, Post, Query, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable, map } from 'rxjs';
import { Role, Roles } from '@sfmc/common';
import { CreateMachineDto, CreateWorkOrderDto, MachineStatusDto, UrgencyDto } from './production.dto';
import { ProductionService } from './production.service';

@ApiTags('production')
@ApiBearerAuth()
@Roles(Role.Admin, Role.Operator)
@Controller('production')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('machines')
  machines() {
    return this.production.listMachines();
  }

  @Roles(Role.Admin)
  @Post('machines')
  createMachine(@Body() dto: CreateMachineDto) {
    return this.production.createMachine(dto);
  }

  @Patch('machines/:id/status')
  @ApiOperation({ summary: 'Met une machine en maintenance ou la remet en service' })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MachineStatusDto) {
    return this.production.setMachineStatus(id, dto.status);
  }

  @Get('work-orders')
  workOrders(@Query('status') status?: string, @Query('orderId') orderId?: string) {
    return this.production.listWorkOrders(status, orderId);
  }

  @Get('work-orders/:id')
  workOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.getWorkOrder(id);
  }

  @Post('work-orders')
  @ApiOperation({ summary: 'Crée un ordre de fabrication manuel (hors commande)' })
  create(@Body() dto: CreateWorkOrderDto) {
    return this.production.createManual({ ...dto, urgency: dto.urgency ?? 3 });
  }

  @Patch('work-orders/:id/urgency')
  @ApiOperation({ summary: 'Change l\'urgence d\'un ordre en attente' })
  urgency(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UrgencyDto) {
    return this.production.setUrgency(id, dto.urgency);
  }

  @Get('planning')
  @ApiOperation({ summary: 'Planning prévisionnel priorisé (urgence, ancienneté, échéance, machines)' })
  planning() {
    return this.production.plan();
  }

  @Sse('stream')
  @ApiOperation({ summary: 'Suivi temps réel (Server-Sent Events) : snapshot, progress, completed, heartbeat' })
  stream(@Query('workOrderId') workOrderId?: string): Observable<MessageEvent> {
    return this.production.stream(workOrderId).pipe(map((m) => ({ type: m.type, data: m.data as object })));
  }
}
