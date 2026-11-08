-- Phase C (configurable workflows): each project owns its issue status catalogue. A status has an
-- immutable key (stored on issues), a display name, a category that drives behaviour ('todo',
-- 'in_progress' or 'done') and a position that orders board columns. Issues reference the catalogue
-- with a composite foreign key, so the database rejects a status the project does not define.
CREATE TABLE project_statuses (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,31}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
 category text NOT NULL CHECK (category IN ('todo', 'in_progress', 'done')),
 position integer NOT NULL CHECK (position >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, project_id, key),
 UNIQUE (tenant_id, project_id, position) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE project_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_statuses USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- Existing projects keep the four statuses they have always had.
INSERT INTO project_statuses (tenant_id, project_id, key, name, category, position)
SELECT p.tenant_id, p.id, v.key, v.name, v.category, v.position
FROM projects p
CROSS JOIN (VALUES
  ('todo', 'To do', 'todo', 0),
  ('in_progress', 'In progress', 'in_progress', 1),
  ('in_review', 'In review', 'in_progress', 2),
  ('done', 'Done', 'done', 3)) AS v(key, name, category, position);

-- Issues may only use statuses defined by their project.
ALTER TABLE issues DROP CONSTRAINT issues_status_check;
ALTER TABLE issues ADD CONSTRAINT issues_status_in_project_fk
  FOREIGN KEY (tenant_id, project_id, status) REFERENCES project_statuses (tenant_id, project_id, key);
