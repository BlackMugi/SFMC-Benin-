import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, Role, Roles } from '@sfmc/common';
import { CreateUserDto, RegisterDto, UpdateUserDto, VerifyCredentialsDto } from './user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Inscription publique (rôle client)' })
  register(@Body() dto: RegisterDto) {
    return this.users.register(dto);
  }

  /** Interne : bloqué à la Gateway, réservé aux comptes de service. */
  @Roles(Role.Service)
  @Post('internal/verify')
  @HttpCode(200)
  @ApiOperation({ summary: '[interne] Vérifie email/mot de passe' })
  verify(@Body() dto: VerifyCredentialsDto) {
    return this.users.verifyCredentials(dto.email, dto.password);
  }

  @Roles(Role.Service)
  @Get('internal/:id')
  @ApiOperation({ summary: '[interne] Utilisateur actif par id (rafraîchissement de jeton)' })
  internalById(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findActiveById(id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.findOne(user.id, user);
  }

  @Roles(Role.Admin)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Roles(Role.Admin, Role.Operator)
  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.users.findOne(id, user);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.update(id, dto, user);
  }

  @Roles(Role.Admin)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.remove(id);
  }
}
