-- Phase D (workflow rules): allowed status changes per project. A status with no rules can move to any
-- other status, so projects that never set rules behave as before. Once a status has rules, only the
-- listed targets are allowed from it. A rule can require a custom field to have a value.
CREATE TABLE status_transitions (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 from_key text NOT NULL,
 to_key text NOT NULL,
 requires_field text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, project_id, from_key, to_key),
 CHECK (from_key <> to_key),
 FOREIGN KEY (tenant_id, project_id, from_key) REFERENCES project_statuses (tenant_id, project_id, key) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, project_id, to_key) REFERENCES project_statuses (tenant_id, project_id, key) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, project_id, requires_field) REFERENCES field_definitions (tenant_id, project_id, key));
ALTER TABLE status_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON status_transitions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
