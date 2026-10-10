import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ProductCategory, Sanitize } from '@sfmc/common';

const CATEGORIES = ['cement', 'iron', 'brick', 'aggregate'];

export class CreateWorkOrderDto {
  @IsUUID() productId: string;
  @Sanitize() @IsString() @MinLength(2) @MaxLength(150) productName: string;
  @IsIn(CATEGORIES) category: ProductCategory;
  @IsInt() @Min(1) @Max(1_000_000) quantity: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) urgency?: number;
  @IsOptional() @IsDateString() requiredBy?: string;
}

export class CreateMachineDto {
  @Sanitize() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsIn(CATEGORIES) category: ProductCategory;
  @IsInt() @Min(1) @Max(100_000) ratePerMinute: number;
}

export class MachineStatusDto {
  @IsIn(['IDLE', 'MAINTENANCE']) status: 'IDLE' | 'MAINTENANCE';
}

export class UrgencyDto {
  @IsInt() @Min(1) @Max(5) urgency: number;
}
