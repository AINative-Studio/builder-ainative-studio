CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"level" varchar(20) NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"stack_trace" text,
	"error_type" varchar(100),
	"endpoint" varchar(255),
	"user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_logs_timestamp_idx" ON "error_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "error_logs_error_type_idx" ON "error_logs" USING btree ("error_type");--> statement-breakpoint
CREATE INDEX "error_logs_endpoint_idx" ON "error_logs" USING btree ("endpoint");