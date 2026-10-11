import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1791680541799 implements MigrationInterface {
  name = 'Initial1791680541799';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE TABLE "oauth_clients" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "client_id" character varying NOT NULL, "secret_hash" character varying NOT NULL, "name" character varying NOT NULL, "role" character varying NOT NULL, "scopes" text array NOT NULL DEFAULT '{}', "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_c5c4af500cc8bfc05500fff7f90" UNIQUE ("client_id"), CONSTRAINT "PK_c4759172d3431bae6f04e678e0d" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying NOT NULL, "family_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_3ddc983c5f7bcf132fd8732c3f" ON "refresh_tokens" ("user_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7838d2ba25be1342091b6695f" ON "refresh_tokens" ("token_hash") `);
    await queryRunner.query(`CREATE INDEX "IDX_d5e27da0cd39bc3bb2811fc8ba" ON "refresh_tokens" ("family_id") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_d5e27da0cd39bc3bb2811fc8ba"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a7838d2ba25be1342091b6695f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3ddc983c5f7bcf132fd8732c3f"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "oauth_clients"`);
  }
}
