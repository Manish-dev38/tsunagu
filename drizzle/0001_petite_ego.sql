CREATE TABLE "sync_state" (
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_state_tenant_id_provider_pk" PRIMARY KEY("tenant_id","provider")
);
