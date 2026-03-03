-- Epic 3: Design System MCP Integration
-- Migration for design_tokens table and generations table update

-- Create design_tokens table
CREATE TABLE IF NOT EXISTS "design_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "tokens" jsonb NOT NULL,
  "version" varchar(20) NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for design_tokens
CREATE INDEX IF NOT EXISTS "design_tokens_user_id_idx" ON "design_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "design_tokens_version_idx" ON "design_tokens" ("version");
CREATE UNIQUE INDEX IF NOT EXISTS "design_tokens_user_name_version_unique" ON "design_tokens" ("user_id", "name", "version");

-- Add design_tokens_version_id to generations table
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "design_tokens_version_id" uuid;

-- Create index for design_tokens_version_id
CREATE INDEX IF NOT EXISTS "generations_design_tokens_idx" ON "generations" ("design_tokens_version_id");

-- Add foreign key constraint (note: we use a soft reference to avoid strict FK constraint)
-- This allows tokens to be deleted without affecting generation history
COMMENT ON COLUMN "generations"."design_tokens_version_id" IS 'References design_tokens.id (soft reference)';
