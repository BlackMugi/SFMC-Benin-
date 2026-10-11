import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680578795 implements MigrationInterface {
  name = 'Initial1791680578795';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    // Numérotation séquentielle des factures (INV-AAAA-000001)
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1`);
    await queryRunner.query(`CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "number" character varying NOT NULL, "order_id" uuid NOT NULL, "customer_id" character varying NOT NULL, "customer_email" character varying, "lines" jsonb NOT NULL, "subtotal" numeric(14,2) NOT NULL, "tax" numeric(14,2) NOT NULL, "amount" numeric(14,2) NOT NULL, "currency" character varying NOT NULL DEFAULT 'XOF', "status" character varying NOT NULL DEFAULT 'ISSUED', "payment_method" character varying, "payment_reference" character varying, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "paid_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_6b20aa66f2a835a4f2fbde48724" UNIQUE ("number"), CONSTRAINT "PK_668cef7c22a427fd822cc1be3ce" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ea83c3b911906a3578de2340fd" ON "invoices" ("order_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_65e3145f317bd655481d3f96c7" ON "invoices" ("customer_id") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SEQUENCE IF EXISTS invoice_number_seq`);
    await queryRunner.query(`DROP INDEX "public"."IDX_65e3145f317bd655481d3f96c7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ea83c3b911906a3578de2340fd"`);
    await queryRunner.query(`DROP TABLE "invoices"`);
  }
}
