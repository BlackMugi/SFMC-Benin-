import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalTokenProvider } from './local-token.provider';
import { OAuthClient } from './oauth-client.entity';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { RefreshToken } from './refresh-token.entity';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    // auth-service signe lui-même son jeton de service au lieu de s'appeler.
    CommonModule.forRoot({ serviceName: 'auth-service', events: false, tokenProvider: LocalTokenProvider }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([RefreshToken, OAuthClient]),
  ],
  controllers: [AuthController, OAuthController],
  providers: [TokensService, AuthService, OAuthService],
})
export class AppModule {}
