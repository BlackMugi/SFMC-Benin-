import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, Roles } from '@sfmc/common';
import { AvailabilityDto, CreateWarehouseDto, MovementDto, ThresholdDto, TransferDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('warehouses')
  warehouses() {
    return this.inventory.listWarehouses();
  }

  @Roles(Role.Admin)
  @Post('warehouses')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.inventory.createWarehouse(dto);
  }

  @Roles(Role.Admin, Role.Operator, Role.Service)
  @Get('stocks')
  stocks(@Query('productId') productId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.inventory.listStocks(productId, warehouseId);
  }

  @Roles(Role.Admin, Role.Operator)
  @Get('stocks/alerts')
  @ApiOperation({ summary: 'Stocks sous le seuil critique' })
  alerts() {
    return this.inventory.listAlerts();
  }

  @Roles(Role.Admin, Role.Operator)
  @Patch('stocks/:id/threshold')
  setThreshold(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ThresholdDto) {
    return this.inventory.setThreshold(id, dto.minThreshold);
  }

  @Roles(Role.Admin, Role.Operator)
  @Get('movements')
  @ApiOperation({ summary: 'Historique des mouvements (IN/OUT)' })
  movements(@Query('productId') productId?: string, @Query('warehouseId') warehouseId?: string, @Query('limit') limit?: string) {
    return this.inventory.listMovements(productId, warehouseId, limit ? parseInt(limit, 10) || 100 : 100);
  }

  @Roles(Role.Admin, Role.Operator)
  @Post('movements')
  @ApiOperation({ summary: 'Entrée (production, achat) ou sortie (vente, perte) de stock' })
  move(@Body() dto: MovementDto) {
    return this.inventory.move(dto);
  }

  @Roles(Role.Admin, Role.Operator)
  @Post('transfers')
  @ApiOperation({ summary: 'Transfert entre entrepôts' })
  transfer(@Body() dto: TransferDto) {
    return this.inventory.transfer(dto);
  }

  @Roles(Role.Admin, Role.Operator, Role.Service)
  @Post('availability')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disponibilité agrégée pour une liste d\'articles (utilisé par Order en REST)' })
  availability(@Body() dto: AvailabilityDto) {
    return this.inventory.checkAvailability(dto.items);
  }

  @Get('availability/:productId')
  @ApiOperation({ summary: 'Quantité disponible pour un produit' })
  availabilityOf(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.inventory.availabilityOf(productId);
  }
}
