import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateProductDto } from './product.dto';
import { ProductsService } from './products.service';

function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    exists: jest.fn(async ({ where }: any) => rows.some((r) => r.sku === where.sku)),
    create: (v: any) => ({ id: `p${rows.length + 1}`, ...v }),
    save: jest.fn(async (v: any) => {
      if (!rows.includes(v)) rows.push(v);
      return v;
    }),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
    find: jest.fn(async () => rows),
    count: jest.fn(async () => rows.length),
  };
}

describe('ProductsService', () => {
  it('crée un produit avec unité par défaut et refuse un SKU en double', async () => {
    const repo = makeRepo();
    const svc = new ProductsService(repo as any);
    const p = await svc.create({ sku: 'CIM-1', name: 'Ciment', category: 'cement', unitPrice: 100 });
    expect(p.unit).toBe('unité');
    await expect(svc.create({ sku: 'CIM-1', name: 'Autre', category: 'cement', unitPrice: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('suppression logique : le produit reste lisible mais inactif', async () => {
    const repo = makeRepo();
    const svc = new ProductsService(repo as any);
    const p = await svc.create({ sku: 'FER-1', name: 'Fer', category: 'iron', unitPrice: 10 });
    await svc.remove(p.id);
    expect((await svc.findOne(p.id)).active).toBe(false);
    await expect(svc.findOne('absent')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CreateProductDto', () => {
  it('rejette un prix négatif, une catégorie inconnue et neutralise le HTML', async () => {
    const dto = plainToInstance(CreateProductDto, { sku: 'X-1', name: '<script>alert(1)</script>Brique', category: 'wood', unitPrice: -5 });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property).sort()).toEqual(['category', 'unitPrice']);
    expect(dto.name).toBe('Brique'); // contenu du <script> retiré
  });
});
