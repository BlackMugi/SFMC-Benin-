import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule, typeOrmConfig } from '@sfmc/common';
import { MIGRATIONS } from './migrations';
import { Product } from './product.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    CommonModule.forRoot({ serviceName: 'product-service', events: false }),
    TypeOrmModule.forRootAsync(typeOrmConfig(MIGRATIONS)),
    TypeOrmModule.forFeature([Product]),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class AppModule {}
