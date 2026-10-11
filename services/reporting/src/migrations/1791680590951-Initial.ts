import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680590951 implements MigrationInterface {
  name = 'Initial1791680590951';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE TABLE "sale_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "product_name" character varying NOT NULL, "quantity" integer NOT NULL, "amount" numeric(14,2) NOT NULL, "day" date NOT NULL, CONSTRAINT "UQ_05418e1fa41c4b2dc295b28774a" UNIQUE ("order_id", "product_id"), CONSTRAINT "PK_d3e4396511029d8a97d9e946fb1" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_fbeb10a3de2795d02b45407d1c" ON "sale_lines" ("order_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_886dddc775adf7c1c07eadfdf4" ON "sale_lines" ("day") `);
    await queryRunner.query(`CREATE TABLE "stock_snapshots" ("product_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "quantity" integer NOT NULL DEFAULT '0', "reserved" integer NOT NULL DEFAULT '0', "low" boolean NOT NULL DEFAULT false, "low_threshold" integer, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_54444eda3c31a5c05b1a370f979" PRIMARY KEY ("product_id", "warehouse_id"))`);
    await queryRunner.query(`CREATE TABLE "production_stats" ("work_order_id" uuid NOT NULL, "order_id" uuid, "product_id" uuid NOT NULL, "product_name" character varying NOT NULL, "quantity" integer NOT NULL, "completed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2a58930b298c52c4b9c0045178e" PRIMARY KEY ("work_order_id"))`);
    await queryRunner.query(`CREATE TABLE "event_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_id" character varying NOT NULL, "order_id" uuid, "type" character varying NOT NULL, "source" character varying NOT NULL, "payload" jsonb NOT NULL, "correlation_id" character varying, "at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_d8ccd9b5b44828ea378dd37e691" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5e2189467cdc0b63a5a2b200c1" ON "event_log" ("event_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_fb673c06b7b97c2d8a3c9d409d" ON "event_log" ("order_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_c74145699194e06628209c98a3" ON "event_log" ("type") `);
    await queryRunner.query(`CREATE INDEX "IDX_f7d501533a85d4f5e897a38d6d" ON "event_log" ("at") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_f7d501533a85d4f5e897a38d6d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c74145699194e06628209c98a3"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fb673c06b7b97c2d8a3c9d409d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5e2189467cdc0b63a5a2b200c1"`);
    await queryRunner.query(`DROP TABLE "event_log"`);
    await queryRunner.query(`DROP TABLE "production_stats"`);
    await queryRunner.query(`DROP TABLE "stock_snapshots"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_886dddc775adf7c1c07eadfdf4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fbeb10a3de2795d02b45407d1c"`);
    await queryRunner.query(`DROP TABLE "sale_lines"`);
  }
}
