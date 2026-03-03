CREATE TABLE "design_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"tokens" jsonb NOT NULL,
	"version" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_tokens_user_id_name_version_unique" UNIQUE("user_id","name","version")
);
--> statement-breakpoint
CREATE TABLE "few_shot_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(50) NOT NULL,
	"prompt" text NOT NULL,
	"good_output" text NOT NULL,
	"explanation" text NOT NULL,
	"tags" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "design_tokens_version_id" uuid;--> statement-breakpoint
ALTER TABLE "design_tokens" ADD CONSTRAINT "design_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_tokens_user_id_idx" ON "design_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "design_tokens_version_idx" ON "design_tokens" USING btree ("version");--> statement-breakpoint
CREATE INDEX "few_shot_examples_category_idx" ON "few_shot_examples" USING btree ("category");--> statement-breakpoint
CREATE INDEX "generations_design_tokens_idx" ON "generations" USING btree ("design_tokens_version_id");