-- Phase G (history and reports). Every status change and every tracked field change is recorded
-- in the same transaction as the change, so flow and time reports read facts, not reconstructions.

-- G1. Status history: one row per status change, plus one row when the issue was created.
CREATE TABLE issue_status_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 from_status text,
 to_status text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 changed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);
CREATE INDEX issue_status_history_issue_idx ON issue_status_history(tenant_id, issue_id, changed_at);
CREATE INDEX issue_status_history_time_idx ON issue_status_history(tenant_id, changed_at);

-- G3. Change history: field-level before and after values for tracked fields.
CREATE TABLE issue_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 field text NOT NULL,
 old_value text,
 new_value text,
 actor_id uuid NOT NULL REFERENCES users(id),
 changed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);
CREATE INDEX issue_changes_issue_idx ON issue_changes(tenant_id, issue_id, changed_at);

-- Existing issues start with their creation state, so flow reports have a first point for each one.
-- Status moves made before this migration are not recoverable and are not invented.
INSERT INTO issue_status_history(tenant_id, issue_id, from_status, to_status, actor_id, changed_at)
SELECT i.tenant_id, i.id, NULL, i.status, i.created_by, i.created_at FROM issues i;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['issue_status_history','issue_changes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
