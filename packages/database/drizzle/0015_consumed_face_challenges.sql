CREATE TABLE IF NOT EXISTS "consumed_face_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL UNIQUE,
	"user_id" integer NOT NULL,
	"consumed_at" timestamp DEFAULT now()
);
