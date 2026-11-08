CREATE TABLE "account_records" (
	"user_id" text,
	"key" text,
	"value" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_records_pkey" PRIMARY KEY("user_id","key")
);
