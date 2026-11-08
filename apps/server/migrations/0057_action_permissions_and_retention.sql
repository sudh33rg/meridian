-- 0057_action_permissions_and_retention.sql
-- Attachment retention, custom domain, and logo upload

ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS attachment_retention_days INTEGER NOT NULL DEFAULT 0 CHECK (attachment_retention_days >= 0);
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS logo_url TEXT;
