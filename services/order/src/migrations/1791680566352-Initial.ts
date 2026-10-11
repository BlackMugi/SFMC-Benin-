import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680566352 implements MigrationInterface {
  name = 'Initial1791680566352';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "customer_id" character varying NOT NULL, "customer_email" character varying, "status" character varying NOT NULL DEFAULT 'pending', "phase" character varying NOT NULL DEFAULT 'awaiting_stock', "items" jsonb NOT NULL, "total" numeric(14,2) NOT NULL, "urgency" integer NOT NULL DEFAULT '3', "required_by" TIMESTAMP WITH TIME ZONE, "stock_check" jsonb, "rejection_reason" character varying, "invoice_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_772d0ce0473ac2ccfa26060dbe" ON "orders" ("customer_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_775c9f06fc27ae3ff8fb26f2c4" ON "orders" ("status") `);
    await queryRunner.query(`CREATE TABLE "order_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "status" character varying NOT NULL, "note" character varying NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cc71513680d03ecb01b96655b0c" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_3e8ecdec907bbf6d4cceb3ab2a" ON "order_history" ("order_id") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_3e8ecdec907bbf6d4cceb3ab2a"`);
    await queryRunner.query(`DROP TABLE "order_history"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_775c9f06fc27ae3ff8fb26f2c4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_772d0ce0473ac2ccfa26060dbe"`);
    await queryRunner.query(`DROP TABLE "orders"`);
  }
}
