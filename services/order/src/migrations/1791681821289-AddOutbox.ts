import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutbox1791681821289 implements MigrationInterface {
  name = 'AddOutbox1791681821289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "outbox" ("seq" BIGSERIAL NOT NULL, "event_id" uuid NOT NULL, "type" character varying NOT NULL, "payload" jsonb NOT NULL, "correlation_id" character varying NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "last_error" character varying, CONSTRAINT "UQ_cc0c9e40998e45ecfc5e313429d" UNIQUE ("event_id"), CONSTRAINT "PK_acf0725c6a7245b71c651964ee4" PRIMARY KEY ("seq"))`);
    await queryRunner.query(`CREATE INDEX "IDX_outbox_unpublished" ON "outbox" ("seq") WHERE published_at IS NULL`);
    await queryRunner.query(`CREATE TABLE "processed_events" ("event_id" uuid NOT NULL, "consumer" character varying NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_270df9e0013dff41bb91d555db4" PRIMARY KEY ("event_id", "consumer"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "processed_events"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_outbox_unpublished"`);
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}
