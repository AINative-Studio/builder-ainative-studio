CREATE TABLE "deployment_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(50) NOT NULL,
	"encrypted_token" text NOT NULL,
	"iv" varchar(32) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_credentials_user_id_platform_unique" UNIQUE("user_id","platform")
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"generation_id" uuid,
	"platform" varchar(50) NOT NULL,
	"url" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"deployment_id" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment_credentials" ADD CONSTRAINT "deployment_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_credentials_user_id_idx" ON "deployment_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deployments_user_id_idx" ON "deployments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployments_platform_idx" ON "deployments" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "deployments_generation_id_idx" ON "deployments" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "deployments_created_at_idx" ON "deployments" USING btree ("created_at");