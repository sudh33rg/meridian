-- Phase G4. Dashboards: a named page of widgets over one project. A dashboard is private to its owner
-- unless shared with the workspace. Widgets store only a kind and a small config; their data is computed
-- at read time from the same facts the reports use, so nothing here can go stale.
CREATE TABLE dashboards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 owner_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 shared boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, owner_id) REFERENCES memberships(tenant_id, user_id));
CREATE INDEX dashboards_project_idx ON dashboards(tenant_id, project_id);
CREATE TABLE dashboard_widgets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 dashboard_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('status_counts','priority_counts','assignee_counts','time_by_person','flow','velocity','cycle_summary')),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
 config jsonb NOT NULL DEFAULT '{}',
 position integer NOT NULL CHECK (position >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, dashboard_id) REFERENCES dashboards(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dashboards USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dashboard_widgets USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
