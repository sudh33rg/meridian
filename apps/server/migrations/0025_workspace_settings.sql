-- Phase J5. Workspace settings used by dates, sprints and reports. One row per workspace; a missing
-- row means the defaults below.
CREATE TABLE workspace_settings (
 tenant_id uuid PRIMARY KEY,
 timezone text NOT NULL DEFAULT 'UTC' CHECK (timezone ~ '^[A-Za-z][A-Za-z0-9_+\-]*(/[A-Za-z0-9_+\-]+)*$' AND length(timezone) <= 64),
 working_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK (cardinality(working_days) BETWEEN 1 AND 7),
 week_start smallint NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 0 AND 6),
 default_sprint_days integer NOT NULL DEFAULT 14 CHECK (default_sprint_days BETWEEN 1 AND 60),
 updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_settings USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
