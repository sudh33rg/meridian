-- Phase F3 (issue type schemes): each project owns its issue types. A type has an immutable key
-- (stored on issues), a display name, an icon and a hierarchy level: 0 for standard work, 1 for
-- epic-level work that groups children. Issues reference the project's types with a composite
-- foreign key, so the database rejects a type the project does not define.
-- Default workflow per type and per-type field contexts are not built (see IMPLEMENTATION_STATUS.md).
CREATE TABLE issue_types (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,31}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
 icon text NOT NULL DEFAULT 'task' CHECK (icon IN ('task', 'bug', 'story', 'epic', 'feature', 'improvement', 'incident', 'request')),
 hierarchy_level integer NOT NULL DEFAULT 0 CHECK (hierarchy_level IN (0, 1)),
 position integer NOT NULL CHECK (position >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, project_id, key),
 UNIQUE (tenant_id, project_id, position) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE issue_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_types USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- Existing projects keep the four types they have always had.
INSERT INTO issue_types (tenant_id, project_id, key, name, icon, hierarchy_level, position)
SELECT p.tenant_id, p.id, v.key, v.name, v.key, v.level, v.position
FROM projects p
CROSS JOIN (VALUES
  ('task', 'Task', 0, 0),
  ('bug', 'Bug', 0, 1),
  ('story', 'Story', 0, 2),
  ('epic', 'Epic', 1, 3)) AS v(key, name, level, position);

-- Issues may only use types defined by their project. The fixed CHECK from migration 0001 goes.
ALTER TABLE issues DROP CONSTRAINT issues_kind_check;
ALTER TABLE issues ADD CONSTRAINT issues_kind_in_project_fk
  FOREIGN KEY (tenant_id, project_id, kind) REFERENCES issue_types (tenant_id, project_id, key);
