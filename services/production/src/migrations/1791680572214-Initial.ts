import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680572214 implements MigrationInterface {
  name = 'Initial1791680572214';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE TABLE "machines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "category" character varying NOT NULL, "rate_per_minute" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'IDLE', CONSTRAINT "UQ_005481cad20f051f1ea2126bc01" UNIQUE ("name"), CONSTRAINT "PK_7b0817c674bb984650c5274e713" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_d44f2abb9564173185fbd0772a" ON "machines" ("category") `);
    await queryRunner.query(`CREATE TABLE "work_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid, "product_id" uuid NOT NULL, "product_name" character varying NOT NULL, "category" character varying NOT NULL, "quantity" integer NOT NULL, "urgency" integer NOT NULL DEFAULT '3', "priority_score" double precision NOT NULL DEFAULT '0', "status" character varying NOT NULL DEFAULT 'QUEUED', "progress" double precision NOT NULL DEFAULT '0', "machine_id" uuid, "required_by" TIMESTAMP WITH TIME ZONE, "duration_ms" integer, "started_at" TIMESTAMP WITH TIME ZONE, "quality_result" character varying, "quality_notes" character varying, "quality_checked_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_5815b54fa93e4835ed739ddf15d" UNIQUE ("order_id", "product_id"), CONSTRAINT "PK_29f6c1884082ee6f535aed93660" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_1af1389c2b4f8501472b2f814e" ON "work_orders" ("order_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_84a22e7f4761f9b56f06b48cd6" ON "work_orders" ("status") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_84a22e7f4761f9b56f06b48cd6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1af1389c2b4f8501472b2f814e"`);
    await queryRunner.query(`DROP TABLE "work_orders"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d44f2abb9564173185fbd0772a"`);
    await queryRunner.query(`DROP TABLE "machines"`);
  }
}
