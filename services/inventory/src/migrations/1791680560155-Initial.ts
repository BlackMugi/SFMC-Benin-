import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680560155 implements MigrationInterface {
  name = 'Initial1791680560155';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE TABLE "warehouses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "name" character varying NOT NULL, "location" character varying, CONSTRAINT "UQ_d8b96d60ff9a288f5ed862280d9" UNIQUE ("code"), CONSTRAINT "PK_56ae21ee2432b2270b48867e4be" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "stocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "quantity" integer NOT NULL DEFAULT '0', "reserved" integer NOT NULL DEFAULT '0', "min_threshold" integer NOT NULL DEFAULT '10', "alert_active" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_d0c35a47ae5d858c419dd5bf8a1" UNIQUE ("product_id", "warehouse_id"), CONSTRAINT "PK_b5b1ee4ac914767229337974575" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_cdcdc9a4b531cbd24c06bc4f9e" ON "stocks" ("product_id") `);
    await queryRunner.query(`CREATE TABLE "stock_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "stock_id" uuid NOT NULL, "product_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "type" character varying NOT NULL, "quantity" integer NOT NULL, "reason" character varying NOT NULL, "order_id" uuid, "reference" character varying, "date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_57a26b190618550d8e65fb860e7" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_fe1f8086b016f319c4f7f38960" ON "stock_movements" ("stock_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_2c1bb05b80ddcc562cd28d826c" ON "stock_movements" ("product_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_06f0c5a720f8750702edb44bf4" ON "stock_movements" ("reference") `);
    await queryRunner.query(`CREATE INDEX "IDX_4827b42d37a5f169c4bf7e63f9" ON "stock_movements" ("date") `);
    await queryRunner.query(`CREATE TABLE "reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "items" jsonb NOT NULL, "allocations" jsonb NOT NULL DEFAULT '[]', "status" character varying NOT NULL DEFAULT 'PENDING', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_82ff9434d944488ca3bf1946c4" ON "reservations" ("order_id") `);
    await queryRunner.query(`ALTER TABLE "stocks" ADD CONSTRAINT "FK_b9acd455e80b402a2058d11ef46" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stocks" DROP CONSTRAINT "FK_b9acd455e80b402a2058d11ef46"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_82ff9434d944488ca3bf1946c4"`);
    await queryRunner.query(`DROP TABLE "reservations"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4827b42d37a5f169c4bf7e63f9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_06f0c5a720f8750702edb44bf4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2c1bb05b80ddcc562cd28d826c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fe1f8086b016f319c4f7f38960"`);
    await queryRunner.query(`DROP TABLE "stock_movements"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cdcdc9a4b531cbd24c06bc4f9e"`);
    await queryRunner.query(`DROP TABLE "stocks"`);
    await queryRunner.query(`DROP TABLE "warehouses"`);
  }
}
