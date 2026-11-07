-- Phase 1: relation-tuple authorization (v1). Projects are visible to the whole workspace by
-- default; a project can be made private, and access can be granted to users or teams at three
-- levels (viewer < editor < admin). Workspace roles still bound what a grant can do: a workspace
-- viewer can never write, whatever they are granted.

ALTER TABLE projects ADD COLUMN visibility text NOT NULL DEFAULT 'workspace'
  CHECK (visibility IN ('workspace', 'private'));

CREATE TABLE relation_tuples (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  object_type text NOT NULL CHECK (object_type IN ('project')),
  object_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('viewer', 'editor', 'admin')),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'team')),
  subject_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, object_type, object_id, relation, subject_type, subject_id),
  FOREIGN KEY (tenant_id, object_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX relation_tuples_subject_idx ON relation_tuples(tenant_id, subject_type, subject_id);
ALTER TABLE relation_tuples ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON relation_tuples
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- 0 = no access, 1 = viewer, 2 = editor, 3 = admin. NULL when the project is not visible at all
-- (other tenant / unknown id). Runs as the caller, so row level security applies inside it.
CREATE FUNCTION project_access(p_project uuid, p_user uuid, p_role text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT LEAST(
    CASE WHEN p_role = 'viewer' THEN 1 ELSE 3 END,
    GREATEST(
      CASE WHEN p.visibility = 'workspace'
           THEN CASE p_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 3 WHEN 'member' THEN 2 ELSE 1 END
           ELSE CASE WHEN p_role IN ('owner', 'admin') THEN 3 ELSE 0 END END,
      COALESCE((
        SELECT max(CASE t.relation WHEN 'admin' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END)
        FROM relation_tuples t
        WHERE t.tenant_id = p.tenant_id AND t.object_type = 'project' AND t.object_id = p.id
          AND ((t.subject_type = 'user' AND t.subject_id = p_user)
            OR (t.subject_type = 'team' AND EXISTS (
                  SELECT 1 FROM team_members tm
                  WHERE tm.tenant_id = t.tenant_id AND tm.team_id = t.subject_id AND tm.user_id = p_user)))
      ), 0)))
  FROM projects p WHERE p.id = p_project
$$;
