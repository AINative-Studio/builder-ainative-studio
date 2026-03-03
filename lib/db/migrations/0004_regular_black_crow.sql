CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"feedback_text" text,
	"was_edited" boolean DEFAULT false NOT NULL,
	"iterations" integer DEFAULT 1 NOT NULL,
	"edit_changes_summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"generated_code" text NOT NULL,
	"prompt_version_id" uuid,
	"model" varchar(100) NOT NULL,
	"template_used" varchar(100),
	"generation_time_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"version" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"is_active" boolean DEFAULT false NOT NULL,
	"ab_test_percentage" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_generation_id_idx" ON "feedback" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "feedback_rating_idx" ON "feedback" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "feedback_created_at_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generations_prompt_version_idx" ON "generations" USING btree ("prompt_version_id");--> statement-breakpoint
CREATE INDEX "generations_user_id_idx" ON "generations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generations_created_at_idx" ON "generations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generations_model_idx" ON "generations" USING btree ("model");--> statement-breakpoint
CREATE INDEX "prompt_versions_type_active_idx" ON "prompt_versions" USING btree ("type","is_active");--> statement-breakpoint
CREATE INDEX "prompt_versions_type_version_idx" ON "prompt_versions" USING btree ("type","version");