-- 0055_automation_branches_and_cross_project.sql
-- Cross-project automation rules and conditional branches

ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS is_cross_project BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS branches JSONB NOT NULL DEFAULT '[]'::jsonb;
