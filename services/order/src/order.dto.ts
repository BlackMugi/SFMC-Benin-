import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class OrderItemDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(100_000) quantity: number;
}

export class CreateOrderDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items: OrderItemDto[];

  /** 1 (faible) à 5 (critique) - priorise la production si le stock est insuffisant */
  @IsOptional() @IsInt() @Min(1) @Max(5)
  urgency?: number;

  @IsOptional() @IsDateString()
  requiredBy?: string;
}
