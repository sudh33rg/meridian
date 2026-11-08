-- Phase J2 (issue security levels). A project can define security levels and put issues in them. An
-- issue with a level is visible only to project admins (level 3), its assignee, its reporter, and the
-- members of its level. The rule is a restrictive row level security policy, so it applies to every
-- read the application makes as the restricted role: lists, search, boards, backlogs, reports,
-- dashboards, exports and the detail routes. The background jobs use the owner connection and are not
-- filtered; the purge and the sprint burndown capture both need every row.
CREATE TABLE security_levels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, project_id, name),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE security_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_levels USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

CREATE TABLE security_level_members (
 tenant_id uuid NOT NULL,
 level_id uuid NOT NULL,
 user_id uuid NOT NULL,
 PRIMARY KEY (tenant_id, level_id, user_id),
 FOREIGN KEY (tenant_id, level_id) REFERENCES security_levels(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
ALTER TABLE security_level_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_level_members USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE issues ADD COLUMN security_level_id uuid;
ALTER TABLE issues ADD CONSTRAINT issues_security_level_fk FOREIGN KEY (tenant_id, security_level_id) REFERENCES security_levels(tenant_id, id);
CREATE INDEX issues_security_level_idx ON issues(tenant_id, security_level_id) WHERE security_level_id IS NOT NULL;

-- The caller's id and workspace role, set per request next to the tenant. Empty when unset, which
-- hides restricted issues from any connection that did not set them.
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.role', true), '') $$;

CREATE POLICY issue_security ON issues AS RESTRICTIVE FOR SELECT USING (
 security_level_id IS NULL
 OR project_access(project_id, app_user(), app_role()) >= 3
 OR assignee_id = app_user()
 OR created_by = app_user()
 OR EXISTS (SELECT 1 FROM security_level_members m WHERE m.tenant_id = issues.tenant_id
   AND m.level_id = issues.security_level_id AND m.user_id = app_user()));
