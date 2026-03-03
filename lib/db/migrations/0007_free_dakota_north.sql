CREATE TABLE "template_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"template_data" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"code" text NOT NULL,
	"preview_image_url" text,
	"tags" jsonb NOT NULL,
	"metadata" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_submissions" ADD CONSTRAINT "template_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_submissions" ADD CONSTRAINT "template_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_submissions_status_idx" ON "template_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "template_submissions_user_id_idx" ON "template_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "template_submissions_submitted_at_idx" ON "template_submissions" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "templates_category_idx" ON "templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "templates_usage_count_idx" ON "templates" USING btree ("usage_count");--> statement-breakpoint
CREATE INDEX "templates_is_active_idx" ON "templates" USING btree ("is_active");