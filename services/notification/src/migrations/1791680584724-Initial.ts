import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680584724 implements MigrationInterface {
  name = 'Initial1791680584724';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_id" character varying NOT NULL, "event_type" character varying NOT NULL, "recipient" character varying NOT NULL, "channel" character varying NOT NULL DEFAULT 'EMAIL', "subject" character varying NOT NULL, "body" text NOT NULL, "status" character varying NOT NULL DEFAULT 'SENT', "correlation_id" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_3a0ff077371d05780d1c1410de5" UNIQUE ("event_id", "recipient"), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_5f72b18550cb22c8dab19da37f" ON "notifications" ("event_type") `);
    await queryRunner.query(`CREATE INDEX "IDX_b78edd430e2dc39d22fb49ff64" ON "notifications" ("recipient") `);
    await queryRunner.query(`CREATE TABLE "order_contacts" ("order_id" uuid NOT NULL, "email" character varying NOT NULL, CONSTRAINT "PK_f0d030898f24f91243e1a4fc9e3" PRIMARY KEY ("order_id"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_contacts"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b78edd430e2dc39d22fb49ff64"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5f72b18550cb22c8dab19da37f"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
