import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Role, Roles } from '@sfmc/common';
import { OrderStatus } from './entities';
import { CreateOrderDto } from './order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Roles(Role.Client, Role.Admin, Role.Operator)
  @Post()
  @ApiOperation({ summary: 'Crée une commande (pending) et démarre la saga (réservation de stock, production si besoin)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Roles(Role.Client, Role.Admin, Role.Operator)
  @Get()
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'validated', 'shipped', 'rejected', 'cancelled'] })
  list(@CurrentUser() user: AuthUser, @Query('status') status?: OrderStatus) {
    return this.orders.list(user, status);
  }

  @Roles(Role.Client, Role.Admin, Role.Operator)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.get(id, user);
  }

  @Roles(Role.Client, Role.Admin, Role.Operator)
  @Get(':id/history')
  @ApiOperation({ summary: 'Historique des changements de statut' })
  history(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.timeline(id, user);
  }

  @Roles(Role.Client, Role.Admin, Role.Operator)
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annule une commande pending ou validated (libère le stock réservé)' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.cancel(id, user);
  }

  @Roles(Role.Admin, Role.Operator)
  @Post(':id/ship')
  @HttpCode(200)
  @ApiOperation({ summary: 'Expédie une commande validée (sortie de stock)' })
  ship(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.ship(id);
  }
}
