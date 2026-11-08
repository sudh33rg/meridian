-- Phase K3 (knowledge parity, first part): page templates per project. A template is a starting
-- body for a new page. Project editors manage templates; any member who can see the project can use them.
CREATE TABLE page_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 body text NOT NULL DEFAULT '' CHECK (length(body) <= 100000),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, project_id, name),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE page_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON page_templates USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
