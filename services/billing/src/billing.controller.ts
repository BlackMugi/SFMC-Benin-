import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AuthUser, CurrentUser, Role, Roles } from '@sfmc/common';
import { BillingService } from './billing.service';

export class PayDto {
  @IsIn(['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CASH'])
  method: string;
}

@ApiTags('invoices')
@ApiBearerAuth()
@Roles(Role.Client, Role.Admin, Role.Operator)
@Controller('invoices')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.billing.list(user);
  }

  @Get('by-order/:orderId')
  byOrder(@Param('orderId', ParseUUIDPipe) orderId: string, @CurrentUser() user: AuthUser) {
    return this.billing.getByOrder(orderId, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.billing.get(id, user);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Règle une facture (fournisseur de paiement simulé)' })
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto, @CurrentUser() user: AuthUser) {
    return this.billing.pay(id, dto.method, user);
  }
}
