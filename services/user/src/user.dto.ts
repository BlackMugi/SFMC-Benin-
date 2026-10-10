import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role, Sanitize } from '@sfmc/common';

export class RegisterDto {
  @IsEmail() @MaxLength(254)
  email: string;

  @IsString() @MinLength(8) @MaxLength(72)
  password: string;

  @Sanitize() @IsString() @MinLength(1) @MaxLength(80)
  firstName: string;

  @Sanitize() @IsString() @MinLength(1) @MaxLength(80)
  lastName: string;
}

export class CreateUserDto extends RegisterDto {
  @IsIn([Role.Admin, Role.Operator, Role.Client])
  role: Role.Admin | Role.Operator | Role.Client;
}

export class UpdateUserDto {
  @IsOptional() @Sanitize() @IsString() @MinLength(1) @MaxLength(80)
  firstName?: string;

  @IsOptional() @Sanitize() @IsString() @MinLength(1) @MaxLength(80)
  lastName?: string;

  @IsOptional() @IsString() @MinLength(8) @MaxLength(72)
  password?: string;

  /** Réservé aux administrateurs */
  @IsOptional() @IsIn([Role.Admin, Role.Operator, Role.Client])
  role?: Role.Admin | Role.Operator | Role.Client;

  /** Réservé aux administrateurs */
  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class VerifyCredentialsDto {
  @IsEmail() email: string;
  @IsString() @MaxLength(72) password: string;
}
