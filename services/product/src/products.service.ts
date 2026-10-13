import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ProductCategory, envBool } from '@sfmc/common';
import { CreateProductDto, UpdateProductDto } from './product.dto';
import { Product } from './product.entity';

export const DEMO_CATALOG: CreateProductDto[] = [
  { sku: 'CIM-CPJ425-50', name: 'Ciment CPJ 42.5 (sac 50 kg)', category: 'cement', unit: 'sac', unitPrice: 6500, description: 'Ciment Portland composé pour béton courant' },
  { sku: 'FER-HA12-12M', name: 'Fer à béton HA12 (barre 12 m)', category: 'iron', unit: 'barre', unitPrice: 7800, description: 'Acier haute adhérence' },
  { sku: 'BRQ-CRX-15', name: 'Brique creuse 15 cm', category: 'brick', unit: 'unité', unitPrice: 350, description: 'Brique en béton vibré' },
  { sku: 'GRA-515', name: 'Granulat 5/15 (tonne)', category: 'aggregate', unit: 'tonne', unitPrice: 12000, description: 'Gravier concassé' },
];

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly log = new Logger(ProductsService.name);

  constructor(@InjectRepository(Product) private readonly repo: Repository<Product>) {}

  async onModuleInit() {
    if (!envBool('SEED_DEMO_DATA', true) || (await this.repo.count()) > 0) return;
    await this.repo.save(DEMO_CATALOG.map((p) => this.repo.create({ ...p, description: p.description ?? null })));
    this.log.log(`Catalogue de démonstration créé (${DEMO_CATALOG.length} produits)`);
  }

  async create(dto: CreateProductDto): Promise<Product> {
    if (await this.repo.exists({ where: { sku: dto.sku } })) throw new ConflictException('SKU déjà utilisé');
    return this.repo.save(this.repo.create({ ...dto, unit: dto.unit ?? 'unité', description: dto.description ?? null }));
  }

  findAll(category?: ProductCategory, onlyActive = true): Promise<Product[]> {
    const where: FindOptionsWhere<Product> = {};
    if (category) where.category = category;
    if (onlyActive) where.active = true;
    return this.repo.find({ where, order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Product> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Produit introuvable');
    return p;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const p = await this.findOne(id);
    Object.assign(p, dto);
    return this.repo.save(p);
  }

  /** Suppression logique : commandes et factures historiques référencent encore le produit. */
  async remove(id: string): Promise<void> {
    const p = await this.findOne(id);
    p.active = false;
    await this.repo.save(p);
  }
}
