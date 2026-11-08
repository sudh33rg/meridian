-- Phase J1 (permission schemes). Each project can set the level a workspace member gets by default,
-- the level needed to change issues, and the level needed to change the workflow and fields. A project
-- without a row uses the defaults, which are the behaviour before schemes existed. Project owners and
-- admins keep level 3 whatever the scheme says, so a scheme cannot lock them out.
CREATE TABLE project_permission_schemes (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 member_level smallint NOT NULL DEFAULT 2 CHECK (member_level IN (1, 2)),
 edit_min smallint NOT NULL DEFAULT 2 CHECK (edit_min IN (2, 3)),
 workflow_min smallint NOT NULL DEFAULT 3 CHECK (workflow_min IN (2, 3)),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, project_id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE project_permission_schemes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_permission_schemes USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- Same rules as 0009, except that a workspace member's level comes from the project's scheme.
CREATE OR REPLACE FUNCTION project_access(p_project uuid, p_user uuid, p_role text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT LEAST(
    CASE p_role WHEN 'viewer' THEN 1 WHEN 'guest' THEN 2 ELSE 3 END,
    GREATEST(
      CASE WHEN p.visibility = 'workspace'
           THEN CASE p_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 3 WHEN 'member' THEN COALESCE(s.member_level, 2) WHEN 'guest' THEN 0 ELSE 1 END
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
  FROM projects p
  LEFT JOIN project_permission_schemes s ON s.tenant_id = p.tenant_id AND s.project_id = p.id
  WHERE p.id = p_project
$$;
