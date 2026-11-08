-- Phase F (issue model depth): components, estimates and worklogs, watchers and votes, checklists.
-- Subtasks already exist through issues.parent_id; this adds the index their roll-up needs.

-- F1. Components: project-scoped groups an issue can belong to, with an optional default assignee.
CREATE TABLE components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
 description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
 default_assignee_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, id),
 UNIQUE (tenant_id, project_id, name),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, default_assignee_id) REFERENCES memberships(tenant_id, user_id));
CREATE TABLE issue_components (
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 component_id uuid NOT NULL,
 PRIMARY KEY (tenant_id, issue_id, component_id),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, component_id) REFERENCES components(tenant_id, id) ON DELETE CASCADE);
CREATE INDEX issue_components_component_idx ON issue_components(tenant_id, component_id);

-- F2. Subtask roll-up reads children by parent.
CREATE INDEX issues_parent_idx ON issues(tenant_id, parent_id) WHERE parent_id IS NOT NULL;

-- F4. Estimates (minutes) on the issue; worklogs record time spent.
ALTER TABLE issues ADD COLUMN original_estimate_minutes integer CHECK (original_estimate_minutes BETWEEN 0 AND 100000000);
ALTER TABLE issues ADD COLUMN remaining_estimate_minutes integer CHECK (remaining_estimate_minutes BETWEEN 0 AND 100000000);
CREATE TABLE worklogs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 author_id uuid NOT NULL,
 minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 100000),
 started_on date NOT NULL,
 comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, author_id) REFERENCES memberships(tenant_id, user_id));
CREATE INDEX worklogs_issue_idx ON worklogs(tenant_id, issue_id);
CREATE INDEX worklogs_author_idx ON worklogs(tenant_id, author_id, started_on);

-- F4. Watchers receive updates about an issue; votes count interest.
CREATE TABLE issue_watchers (
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, issue_id, user_id),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
CREATE TABLE issue_votes (
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, issue_id, user_id),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);

-- F5. Checklists: ordered tick items inside an issue.
CREATE TABLE checklist_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 500),
 done boolean NOT NULL DEFAULT false,
 position double precision NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE,
 UNIQUE (tenant_id, id));
CREATE INDEX checklist_items_issue_idx ON checklist_items(tenant_id, issue_id, position);

-- Row level security on every new tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['components','issue_components','worklogs','issue_watchers','issue_votes','checklist_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
