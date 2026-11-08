-- Phase F6 (issue lifecycle): trash. Moving an issue to trash archives it and records when it was
-- trashed and until when it can be restored (30 days). Nothing is purged automatically yet: several
-- foreign keys to issues have no cascade, so a purge job needs its own plan (see IMPLEMENTATION_STATUS.md).
ALTER TABLE issues ADD COLUMN trashed_at timestamptz;
ALTER TABLE issues ADD COLUMN purge_after timestamptz;
ALTER TABLE issues ADD COLUMN trashed_by uuid REFERENCES users(id);
CREATE INDEX issues_trash_idx ON issues(tenant_id, project_id, trashed_at) WHERE trashed_at IS NOT NULL;
