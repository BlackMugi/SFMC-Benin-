import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Sanitize } from '@sfmc/common';

export class CreateWarehouseDto {
  @Matches(/^[A-Z0-9_-]{2,20}$/, { message: 'code : majuscules, chiffres, - _ (2 à 20)' })
  code: string;

  @Sanitize() @IsString() @MinLength(2) @MaxLength(100)
  name: string;

  @IsOptional() @Sanitize() @IsString() @MaxLength(200)
  location?: string;
}

export class MovementDto {
  @IsUUID() productId: string;
  @IsUUID() warehouseId: string;
  @IsIn(['IN', 'OUT']) type: 'IN' | 'OUT';
  @IsInt() @Min(1) @Max(10_000_000) quantity: number;
  @IsIn(['PRODUCTION', 'PURCHASE', 'RETURN', 'SALE', 'LOSS', 'ADJUSTMENT']) reason: string;
}

export class TransferDto {
  @IsUUID() productId: string;
  @IsUUID() fromWarehouseId: string;
  @IsUUID() toWarehouseId: string;
  @IsInt() @Min(1) @Max(10_000_000) quantity: number;
}

export class ThresholdDto {
  @IsInt() @Min(0) @Max(10_000_000) minThreshold: number;
}

export class AvailabilityItemDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(10_000_000) quantity: number;
}

export class AvailabilityDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AvailabilityItemDto)
  items: AvailabilityItemDto[];
}
