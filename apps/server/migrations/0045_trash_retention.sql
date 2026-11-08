-- Phase J4 (retention). The number of days a trashed issue waits before it is purged, set per workspace.
-- Audit records are not deleted by any job: they are kept indefinitely.
ALTER TABLE workspace_settings ADD COLUMN trash_retention_days integer NOT NULL DEFAULT 30 CHECK (trash_retention_days BETWEEN 7 AND 365);
