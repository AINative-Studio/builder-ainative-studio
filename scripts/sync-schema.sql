-- Schema sync script for builder-ainative-studio
-- Creates all missing tables from lib/db/schema.ts
-- Safe to run multiple times (uses IF NOT EXISTS)

-- error_logs
CREATE TABLE IF NOT EXISTS "error_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "timestamp" timestamp DEFAULT now() NOT NULL,
  "level" varchar(20) NOT NULL,
  "message" text NOT NULL,
  "context" jsonb,
  "stack_trace" text,
  "error_type" varchar(100),
  "endpoint" varchar(255),
  "user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "error_logs_timestamp_idx" ON "error_logs" ("timestamp");
CREATE INDEX IF NOT EXISTS "error_logs_error_type_idx" ON "error_logs" ("error_type");
CREATE INDEX IF NOT EXISTS "error_logs_endpoint_idx" ON "error_logs" ("endpoint");

-- generations
CREATE TABLE IF NOT EXISTS "generations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "chat_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "prompt" text NOT NULL,
  "generated_code" text NOT NULL,
  "prompt_version_id" uuid REFERENCES "prompt_versions"("id"),
  "design_tokens_version_id" uuid,
  "model" varchar(100) NOT NULL,
  "template_used" varchar(100),
  "generation_time_ms" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "generations_prompt_version_idx" ON "generations" ("prompt_version_id");
CREATE INDEX IF NOT EXISTS "generations_user_id_idx" ON "generations" ("user_id");
CREATE INDEX IF NOT EXISTS "generations_created_at_idx" ON "generations" ("created_at");
CREATE INDEX IF NOT EXISTS "generations_model_idx" ON "generations" ("model");
CREATE INDEX IF NOT EXISTS "generations_design_tokens_idx" ON "generations" ("design_tokens_version_id");

-- feedback
CREATE TABLE IF NOT EXISTS "feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "generation_id" uuid NOT NULL REFERENCES "generations"("id"),
  "rating" integer NOT NULL,
  "feedback_text" text,
  "was_edited" boolean NOT NULL DEFAULT false,
  "iterations" integer NOT NULL DEFAULT 1,
  "edit_changes_summary" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "feedback_generation_id_idx" ON "feedback" ("generation_id");
CREATE INDEX IF NOT EXISTS "feedback_rating_idx" ON "feedback" ("rating");
CREATE INDEX IF NOT EXISTS "feedback_created_at_idx" ON "feedback" ("created_at");

-- chats
CREATE TABLE IF NOT EXISTS "chats" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "chats_user_id_idx" ON "chats" ("user_id");
CREATE INDEX IF NOT EXISTS "chats_created_at_idx" ON "chats" ("created_at");

-- design_tokens
CREATE TABLE IF NOT EXISTS "design_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "tokens" jsonb NOT NULL,
  "version" varchar(20) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "design_tokens_user_id_idx" ON "design_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "design_tokens_version_idx" ON "design_tokens" ("version");

-- few_shot_examples
CREATE TABLE IF NOT EXISTS "few_shot_examples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" varchar(50) NOT NULL,
  "prompt" text NOT NULL,
  "good_output" text NOT NULL,
  "explanation" text NOT NULL,
  "tags" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "few_shot_examples_category_idx" ON "few_shot_examples" ("category");

-- templates
CREATE TABLE IF NOT EXISTS "templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "category" varchar(50) NOT NULL,
  "description" text NOT NULL,
  "code" text NOT NULL,
  "preview_image_url" text,
  "tags" jsonb NOT NULL,
  "metadata" jsonb NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "usage_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "templates_category_idx" ON "templates" ("category");
CREATE INDEX IF NOT EXISTS "templates_usage_count_idx" ON "templates" ("usage_count");
CREATE INDEX IF NOT EXISTS "templates_is_active_idx" ON "templates" ("is_active");

-- template_submissions
CREATE TABLE IF NOT EXISTS "template_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "template_data" jsonb NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "admin_notes" text,
  "submitted_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_at" timestamp,
  "reviewed_by" uuid REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "template_submissions_status_idx" ON "template_submissions" ("status");
CREATE INDEX IF NOT EXISTS "template_submissions_user_id_idx" ON "template_submissions" ("user_id");
CREATE INDEX IF NOT EXISTS "template_submissions_submitted_at_idx" ON "template_submissions" ("submitted_at");

-- deployments
CREATE TABLE IF NOT EXISTS "deployments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "generation_id" uuid REFERENCES "generations"("id") ON DELETE SET NULL,
  "platform" varchar(50) NOT NULL,
  "url" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "deployment_id" varchar(255),
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "deployments_user_id_idx" ON "deployments" ("user_id");
CREATE INDEX IF NOT EXISTS "deployments_status_idx" ON "deployments" ("status");
CREATE INDEX IF NOT EXISTS "deployments_platform_idx" ON "deployments" ("platform");
CREATE INDEX IF NOT EXISTS "deployments_generation_id_idx" ON "deployments" ("generation_id");
CREATE INDEX IF NOT EXISTS "deployments_created_at_idx" ON "deployments" ("created_at");

-- deployment_credentials
CREATE TABLE IF NOT EXISTS "deployment_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" varchar(50) NOT NULL,
  "encrypted_token" text NOT NULL,
  "iv" varchar(32) NOT NULL,
  "auth_tag" varchar(32) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "deployment_credentials_user_id_idx" ON "deployment_credentials" ("user_id");

-- rule_sets
CREATE TABLE IF NOT EXISTS "rule_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "is_built_in" boolean NOT NULL DEFAULT false,
  "team_id" uuid,
  "version" varchar(20) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "rule_sets_is_built_in_idx" ON "rule_sets" ("is_built_in");
CREATE INDEX IF NOT EXISTS "rule_sets_team_id_idx" ON "rule_sets" ("team_id");

-- enforcement_rules
CREATE TABLE IF NOT EXISTS "enforcement_rules" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "level" varchar(20) NOT NULL DEFAULT 'error',
  "category" varchar(50) NOT NULL,
  "contexts" jsonb NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "tags" jsonb NOT NULL,
  "rule_set_id" uuid REFERENCES "rule_sets"("id") ON DELETE CASCADE,
  "docs_url" text,
  "examples" jsonb,
  "options" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "enforcement_rules_category_idx" ON "enforcement_rules" ("category");
CREATE INDEX IF NOT EXISTS "enforcement_rules_enabled_idx" ON "enforcement_rules" ("enabled");
CREATE INDEX IF NOT EXISTS "enforcement_rules_rule_set_id_idx" ON "enforcement_rules" ("rule_set_id");
CREATE INDEX IF NOT EXISTS "enforcement_rules_level_idx" ON "enforcement_rules" ("level");

-- rule_violations
CREATE TABLE IF NOT EXISTS "rule_violations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_id" varchar(255) NOT NULL REFERENCES "enforcement_rules"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" varchar(255),
  "action_type" varchar(50) NOT NULL,
  "action_data" jsonb NOT NULL,
  "violation_message" text NOT NULL,
  "violation_details" text,
  "location" jsonb,
  "suggestion" text,
  "auto_fixable" boolean NOT NULL DEFAULT false,
  "fixed" boolean NOT NULL DEFAULT false,
  "fix_method" varchar(20),
  "time_to_fix_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "fixed_at" timestamp
);
CREATE INDEX IF NOT EXISTS "rule_violations_rule_id_idx" ON "rule_violations" ("rule_id");
CREATE INDEX IF NOT EXISTS "rule_violations_user_id_idx" ON "rule_violations" ("user_id");
CREATE INDEX IF NOT EXISTS "rule_violations_created_at_idx" ON "rule_violations" ("created_at");

-- enforcement_reports
CREATE TABLE IF NOT EXISTS "enforcement_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" varchar(255),
  "action_type" varchar(50) NOT NULL,
  "action_data" jsonb NOT NULL,
  "passed" boolean NOT NULL,
  "error_count" integer NOT NULL DEFAULT 0,
  "warning_count" integer NOT NULL DEFAULT 0,
  "info_count" integer NOT NULL DEFAULT 0,
  "total_duration_ms" integer NOT NULL,
  "can_auto_fix" boolean NOT NULL DEFAULT false,
  "suggestions" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "enforcement_reports_user_id_idx" ON "enforcement_reports" ("user_id");
CREATE INDEX IF NOT EXISTS "enforcement_reports_created_at_idx" ON "enforcement_reports" ("created_at");

-- enforcement_configs
CREATE TABLE IF NOT EXISTS "enforcement_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rule_set_ids" jsonb NOT NULL,
  "rule_configs" jsonb NOT NULL,
  "settings" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "enforcement_configs_project_id_idx" ON "enforcement_configs" ("project_id");
CREATE INDEX IF NOT EXISTS "enforcement_configs_user_id_idx" ON "enforcement_configs" ("user_id");

-- skills
CREATE TABLE IF NOT EXISTS "skills" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "version" varchar(20) NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "author_name" varchar(255) NOT NULL,
  "author_email" varchar(255),
  "tags" jsonb NOT NULL,
  "trigger_patterns" jsonb,
  "dependencies" jsonb,
  "token_cost_metadata" integer NOT NULL DEFAULT 100,
  "token_cost_full" integer NOT NULL DEFAULT 2000,
  "compatibility" jsonb,
  "content" text NOT NULL,
  "references" jsonb,
  "examples" jsonb,
  "validation_rules" jsonb,
  "commands" jsonb,
  "is_built_in" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "skills_author_id_idx" ON "skills" ("author_id");
CREATE INDEX IF NOT EXISTS "skills_is_built_in_idx" ON "skills" ("is_built_in");
CREATE INDEX IF NOT EXISTS "skills_is_active_idx" ON "skills" ("is_active");

-- skill_collections
CREATE TABLE IF NOT EXISTS "skill_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "skill_ids" jsonb NOT NULL,
  "is_built_in" boolean NOT NULL DEFAULT false,
  "is_team" boolean NOT NULL DEFAULT false,
  "team_id" uuid,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- skill_usage
CREATE TABLE IF NOT EXISTS "skill_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "skill_id" varchar(255) NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" varchar(255),
  "project_id" varchar(255),
  "load_type" varchar(20) NOT NULL,
  "trigger_pattern" varchar(255),
  "context" jsonb,
  "load_time_ms" integer NOT NULL,
  "metadata_loaded" boolean NOT NULL DEFAULT true,
  "content_loaded" boolean NOT NULL DEFAULT false,
  "references_loaded" boolean NOT NULL DEFAULT false,
  "tokens_used" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "skill_usage_skill_id_idx" ON "skill_usage" ("skill_id");
CREATE INDEX IF NOT EXISTS "skill_usage_user_id_idx" ON "skill_usage" ("user_id");

-- skill_ratings
CREATE TABLE IF NOT EXISTS "skill_ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "skill_id" varchar(255) NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rating" integer NOT NULL,
  "feedback_text" text,
  "helpful" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "skill_ratings_skill_id_idx" ON "skill_ratings" ("skill_id");

-- budget_tracking
CREATE TABLE IF NOT EXISTS "budget_tracking" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "total_tokens" integer NOT NULL DEFAULT 128000,
  "used_tokens" integer NOT NULL DEFAULT 0,
  "remaining_tokens" integer NOT NULL DEFAULT 128000,
  "usage_percentage" integer NOT NULL DEFAULT 0,
  "is_warning" boolean NOT NULL DEFAULT false,
  "is_critical" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "budget_tracking_session_id_idx" ON "budget_tracking" ("session_id");

-- context_items
CREATE TABLE IF NOT EXISTS "context_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "token_cost" integer NOT NULL,
  "priority" varchar(20) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'loaded',
  "last_accessed_at" timestamp,
  "access_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "loaded_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "context_items_session_id_idx" ON "context_items" ("session_id");
CREATE INDEX IF NOT EXISTS "context_items_type_idx" ON "context_items" ("type");

-- budget_events
CREATE TABLE IF NOT EXISTS "budget_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" varchar(50) NOT NULL,
  "item_id" uuid REFERENCES "context_items"("id") ON DELETE SET NULL,
  "token_delta" integer NOT NULL,
  "budget_snapshot" jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "budget_events_session_id_idx" ON "budget_events" ("session_id");

-- budget_configurations
CREATE TABLE IF NOT EXISTS "budget_configurations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "total_tokens" integer NOT NULL DEFAULT 128000,
  "warning_threshold" integer NOT NULL DEFAULT 80,
  "critical_threshold" integer NOT NULL DEFAULT 95,
  "auto_unload_enabled" boolean NOT NULL DEFAULT true,
  "auto_unload_min_access_count" integer NOT NULL DEFAULT 1,
  "auto_unload_min_time_ms" integer NOT NULL DEFAULT 300000,
  "compression_enabled" boolean NOT NULL DEFAULT true,
  "auto_compress" boolean NOT NULL DEFAULT false,
  "compression_threshold" integer NOT NULL DEFAULT 2000,
  "category_preferences" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "budget_configurations_user_id_idx" ON "budget_configurations" ("user_id");

-- agent_commands
CREATE TABLE IF NOT EXISTS "agent_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "category" varchar(50) NOT NULL,
  "icon" varchar(50),
  "tags" jsonb NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "author_name" varchar(255) NOT NULL,
  "template" text NOT NULL,
  "variables" jsonb NOT NULL,
  "required_skills" jsonb NOT NULL,
  "validation_rules" jsonb,
  "pre_conditions" jsonb NOT NULL,
  "checkpoints" jsonb NOT NULL,
  "output" jsonb NOT NULL,
  "version" varchar(20) NOT NULL DEFAULT '1.0.0',
  "is_built_in" boolean NOT NULL DEFAULT false,
  "is_team" boolean NOT NULL DEFAULT false,
  "team_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "usage_count" integer NOT NULL DEFAULT 0,
  "avg_execution_time_ms" integer,
  "success_rate" integer,
  "shortcut" varchar(50),
  "estimated_token_cost" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "agent_commands_category_idx" ON "agent_commands" ("category");
CREATE INDEX IF NOT EXISTS "agent_commands_is_active_idx" ON "agent_commands" ("is_active");

-- command_favorites
CREATE TABLE IF NOT EXISTS "command_favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "command_id" uuid NOT NULL REFERENCES "agent_commands"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- command_executions
CREATE TABLE IF NOT EXISTS "command_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "command_id" uuid NOT NULL REFERENCES "agent_commands"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "chat_id" varchar(255) REFERENCES "chats"("id") ON DELETE SET NULL,
  "variable_values" jsonb NOT NULL,
  "git_context" jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "current_checkpoint_index" integer NOT NULL DEFAULT 0,
  "checkpoint_states" jsonb NOT NULL,
  "pre_condition_results" jsonb NOT NULL,
  "output" jsonb,
  "logs" jsonb NOT NULL,
  "execution_time_ms" integer,
  "token_usage" integer,
  "success" boolean NOT NULL DEFAULT false,
  "error" jsonb,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
CREATE INDEX IF NOT EXISTS "command_executions_command_id_idx" ON "command_executions" ("command_id");
CREATE INDEX IF NOT EXISTS "command_executions_user_id_idx" ON "command_executions" ("user_id");

-- command_templates
CREATE TABLE IF NOT EXISTS "command_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "category" varchar(50) NOT NULL,
  "preview_image" text,
  "template_data" jsonb NOT NULL,
  "is_built_in" boolean NOT NULL DEFAULT false,
  "usage_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- evidence
CREATE TABLE IF NOT EXISTS "evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(50) NOT NULL,
  "status" varchar(20) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "command" text,
  "stdout" text,
  "stderr" text,
  "metadata" jsonb NOT NULL,
  "project_id" varchar(255),
  "git_commit" varchar(255),
  "git_branch" varchar(255),
  "parent_evidence_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "evidence_user_id_idx" ON "evidence" ("user_id");
CREATE INDEX IF NOT EXISTS "evidence_type_idx" ON "evidence" ("type");
CREATE INDEX IF NOT EXISTS "evidence_status_idx" ON "evidence" ("status");
CREATE INDEX IF NOT EXISTS "evidence_created_at_idx" ON "evidence" ("created_at");

-- artifacts
CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL REFERENCES "evidence"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "type" varchar(50) NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "size" integer NOT NULL,
  "storage_path" text NOT NULL,
  "url" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "artifacts_evidence_id_idx" ON "artifacts" ("evidence_id");

-- evidence_verifications
CREATE TABLE IF NOT EXISTS "evidence_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evidence_id" uuid NOT NULL REFERENCES "evidence"("id") ON DELETE CASCADE,
  "claim" text NOT NULL,
  "verified" boolean NOT NULL,
  "verification_method" varchar(100) NOT NULL,
  "verifier" varchar(255),
  "notes" text,
  "verification_date" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "evidence_verifications_evidence_id_idx" ON "evidence_verifications" ("evidence_id");

-- Mark migrations as applied so Drizzle doesn't try to re-run them
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  "id" serial PRIMARY KEY,
  "hash" text NOT NULL,
  "created_at" bigint
);
