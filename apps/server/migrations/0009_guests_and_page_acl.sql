-- Guest role (sees only what is explicitly shared) and page-level restrictions.

ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner','admin','member','viewer','guest'));
ALTER TABLE invitations DROP CONSTRAINT invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('admin','member','viewer','guest'));
ALTER TABLE sso_connections DROP CONSTRAINT sso_connections_default_role_check;
ALTER TABLE sso_connections ADD CONSTRAINT sso_connections_default_role_check CHECK (default_role IN ('member','viewer','guest'));

-- project_access(): guests get nothing by default and can be at most editors on a project.
CREATE OR REPLACE FUNCTION project_access(p_project uuid, p_user uuid, p_role text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT LEAST(
    CASE p_role WHEN 'viewer' THEN 1 WHEN 'guest' THEN 2 ELSE 3 END,
    GREATEST(
      CASE WHEN p.visibility = 'workspace'
           THEN CASE p_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 3 WHEN 'member' THEN 2 WHEN 'guest' THEN 0 ELSE 1 END
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

-- A page can be restricted to specific people/teams; children inherit the nearest restricted
-- ancestor's grants. Project admins always keep access.
ALTER TABLE pages ADD COLUMN restricted boolean NOT NULL DEFAULT false;
CREATE TABLE page_grants (
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('viewer', 'editor')),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'team')),
  subject_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, page_id, subject_type, subject_id),
  FOREIGN KEY (tenant_id, page_id) REFERENCES pages(tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE page_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON page_grants USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- 0 = none, 1 = viewer, 2 = editor, 3 = admin; NULL when the page is not visible at all.
CREATE FUNCTION page_access(p_page uuid, p_user uuid, p_role text) RETURNS integer
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain(id, parent_id, restricted, depth) AS (
    SELECT id, parent_id, restricted, 0 FROM pages WHERE id = p_page
    UNION ALL
    SELECT p.id, p.parent_id, p.restricted, c.depth + 1 FROM pages p JOIN chain c ON p.id = c.parent_id WHERE c.depth < 50
  ),
  nearest AS (SELECT id FROM chain WHERE restricted ORDER BY depth LIMIT 1),
  base AS (SELECT project_access(project_id, p_user, p_role) AS l FROM pages WHERE id = p_page)
  SELECT CASE
    WHEN (SELECT l FROM base) IS NULL THEN NULL
    WHEN (SELECT l FROM base) < 1 THEN 0
    WHEN NOT EXISTS (SELECT 1 FROM nearest) THEN (SELECT l FROM base)
    WHEN (SELECT l FROM base) >= 3 THEN (SELECT l FROM base)
    ELSE LEAST((SELECT l FROM base), COALESCE((
      SELECT max(CASE g.relation WHEN 'editor' THEN 2 ELSE 1 END)
      FROM page_grants g
      WHERE g.page_id = (SELECT id FROM nearest)
        AND ((g.subject_type = 'user' AND g.subject_id = p_user)
          OR (g.subject_type = 'team' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = g.subject_id AND tm.user_id = p_user)))
    ), 0))
  END
$$;
