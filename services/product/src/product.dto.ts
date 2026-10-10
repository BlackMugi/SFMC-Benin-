import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ProductCategory, Sanitize } from '@sfmc/common';

export const CATEGORIES: ProductCategory[] = ['cement', 'iron', 'brick', 'aggregate'];

export class CreateProductDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, { message: 'sku invalide (lettres, chiffres, . _ -)' })
  sku: string;

  @Sanitize() @IsString() @MinLength(2) @MaxLength(150)
  name: string;

  @IsIn(CATEGORIES)
  category: ProductCategory;

  @IsOptional() @Sanitize() @IsString() @MaxLength(30)
  unit?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  unitPrice: number;

  @IsOptional() @Sanitize() @IsString() @MaxLength(1000)
  description?: string;
}

export class UpdateProductDto {
  @IsOptional() @Sanitize() @IsString() @MinLength(2) @MaxLength(150)
  name?: string;

  @IsOptional() @IsIn(CATEGORIES)
  category?: ProductCategory;

  @IsOptional() @Sanitize() @IsString() @MaxLength(30)
  unit?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  unitPrice?: number;

  @IsOptional() @Sanitize() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
