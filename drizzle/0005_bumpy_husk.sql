CREATE TABLE "memory" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
