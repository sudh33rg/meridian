-- Phase J1 (custom roles). A project can define roles with a level (1 viewer, 2 member, 3 admin) and
-- assign members to them. A member's level in the project is the highest of the workspace role, the
-- scheme, the grants, and any custom role they hold.
CREATE TABLE project_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 level smallint NOT NULL CHECK (level IN (1, 2, 3)),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, project_id, name),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE project_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_roles USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

CREATE TABLE project_role_members (
 tenant_id uuid NOT NULL,
 role_id uuid NOT NULL,
 user_id uuid NOT NULL,
 PRIMARY KEY (tenant_id, role_id, user_id),
 FOREIGN KEY (tenant_id, role_id) REFERENCES project_roles(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
CREATE INDEX project_role_members_user_idx ON project_role_members(tenant_id, user_id);
ALTER TABLE project_role_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_role_members USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- Same rules as 0034, plus the highest custom role the user holds in the project.
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
      ), 0),
      COALESCE((
        SELECT max(r.level) FROM project_roles r
        JOIN project_role_members m ON m.tenant_id = r.tenant_id AND m.role_id = r.id
        WHERE r.tenant_id = p.tenant_id AND r.project_id = p.id AND m.user_id = p_user
      ), 0)))
  FROM projects p
  LEFT JOIN project_permission_schemes s ON s.tenant_id = p.tenant_id AND s.project_id = p.id
  WHERE p.id = p_project
$$;
