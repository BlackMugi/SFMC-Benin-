import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680554179 implements MigrationInterface {
  name = 'Initial1791680554179';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sku" character varying NOT NULL, "name" character varying NOT NULL, "category" character varying NOT NULL, "unit" character varying NOT NULL DEFAULT 'unité', "unit_price" numeric(12,2) NOT NULL, "description" text, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_c44ac33a05b144dd0d9ddcf9327" UNIQUE ("sku"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_c3932231d2385ac248d0888d95" ON "products" ("category") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_c3932231d2385ac248d0888d95"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
