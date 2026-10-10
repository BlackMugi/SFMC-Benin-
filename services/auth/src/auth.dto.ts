import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Sanitize } from '@sfmc/common';

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(72) password: string;
}

export class RefreshDto {
  @IsString() @MinLength(20) @MaxLength(200) refreshToken: string;
}

export class TokenRequestDto {
  @IsIn(['client_credentials']) grant_type: string;
  @IsOptional() @IsString() @MaxLength(100) client_id?: string;
  @IsOptional() @IsString() @MaxLength(200) client_secret?: string;
  @IsOptional() @IsString() @MaxLength(300) scope?: string;
}

export class IntrospectDto {
  @IsString() @MaxLength(4096) token: string;
}

export class CreateClientDto {
  @Sanitize() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true }) scopes?: string[];
}
