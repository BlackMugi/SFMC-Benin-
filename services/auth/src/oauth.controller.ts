import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, publicJwks, Role, Roles } from '@sfmc/common';
import { CreateClientDto, IntrospectDto, TokenRequestDto } from './auth.dto';
import { OAuthService } from './oauth.service';

@ApiTags('oauth2')
@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Public()
  @Post('token')
  @HttpCode(200)
  @ApiOperation({ summary: 'OAuth2 client credentials (inter-services et intégrations externes). Identifiants dans le corps ou en HTTP Basic.' })
  token(@Body() dto: TokenRequestDto, @Headers('authorization') authorization?: string) {
    let { client_id: id, client_secret: secret } = dto;
    const basic = /^Basic\s+(.+)$/i.exec(authorization ?? '');
    if (basic) {
      const [bid, ...rest] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
      id = bid;
      secret = rest.join(':');
    }
    if (!id || !secret) throw new UnauthorizedException('invalid_client');
    return this.oauth.clientCredentials(id, secret, dto.scope);
  }

  @Public()
  @Get('jwks')
  @ApiOperation({ summary: 'Clés publiques de vérification des jetons (JWKS, RFC 7517). Seul auth-service possède la clé privée.' })
  jwks() {
    return publicJwks();
  }

  @Roles(Role.Service, Role.Admin)
  @ApiBearerAuth()
  @Post('introspect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Introspection de jeton (RFC 7662)' })
  introspect(@Body() dto: IntrospectDto) {
    return this.oauth.introspect(dto.token);
  }

  @Roles(Role.Admin)
  @ApiBearerAuth()
  @Post('clients')
  @ApiOperation({ summary: 'Crée un client OAuth2 pour une intégration externe (secret affiché une seule fois)' })
  createClient(@Body() dto: CreateClientDto) {
    return this.oauth.createClient(dto.name, dto.scopes);
  }

  @Roles(Role.Admin)
  @ApiBearerAuth()
  @Get('clients')
  list() {
    return this.oauth.list();
  }

  @Roles(Role.Admin)
  @ApiBearerAuth()
  @Delete('clients/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.oauth.remove(id);
  }
}
