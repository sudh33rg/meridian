-- Phase B: personal saved issue views (per user and project) and per-user notification preferences.
-- Both are tenant-scoped with row level security; rows are also private to their user, which the
-- handlers enforce by filtering on user_id.
CREATE TABLE saved_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 filters jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(filters) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, user_id, project_id, name),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
CREATE INDEX saved_views_owner_project_idx ON saved_views(tenant_id, user_id, project_id);
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_views USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- A row exists only when a user has changed the default (enabled). Absent rows mean enabled.
CREATE TABLE notification_preferences (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('approval', 'automation')),
 enabled boolean NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, user_id, kind),
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
