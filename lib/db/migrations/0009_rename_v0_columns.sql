-- Rename v0_chat_id to chat_id in anonymous_chat_logs table
ALTER TABLE "anonymous_chat_logs" RENAME COLUMN "v0_chat_id" TO "chat_id";

-- Rename v0_chat_id to chat_id in chat_ownerships table
ALTER TABLE "chat_ownerships" RENAME COLUMN "v0_chat_id" TO "chat_id";

-- Rename unique constraint in chat_ownerships table
ALTER TABLE "chat_ownerships" RENAME CONSTRAINT "chat_ownerships_v0_chat_id_unique" TO "chat_ownerships_chat_id_unique";
