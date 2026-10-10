import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Role, Roles } from '@sfmc/common';
import { NotificationService } from './notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Roles(Role.Admin, Role.Operator)
  @Get()
  list(@Query('recipient') recipient?: string, @Query('limit') limit?: string) {
    return this.notifications.list(recipient, limit ? parseInt(limit, 10) || 100 : 100);
  }

  @Roles(Role.Client, Role.Admin, Role.Operator)
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.notifications.mine(user);
  }
}
