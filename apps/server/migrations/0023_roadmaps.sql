-- Phase H (roadmaps, portfolio, capacity). Dates are calendar days; progress is derived from linked
-- work where it can be, so it does not drift from the issues it describes.

-- H1. Milestones: named dates a project works towards.
CREATE TABLE milestones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 target_on date NOT NULL,
 reached_on date,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);

-- H2. Initiatives sit above epics. An epic can belong to one initiative.
CREATE TABLE initiatives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
 target_on date,
 owner_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, owner_id) REFERENCES memberships(tenant_id, user_id));
CREATE TABLE initiative_epics (
 tenant_id uuid NOT NULL,
 initiative_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 PRIMARY KEY (tenant_id, issue_id),
 FOREIGN KEY (tenant_id, initiative_id) REFERENCES initiatives(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);

-- H3. Project updates with health, and goal-to-issue links that drive goal progress.
CREATE TABLE project_updates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 author_id uuid NOT NULL,
 health text NOT NULL CHECK (health IN ('on_track','at_risk','off_track')),
 body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, author_id) REFERENCES memberships(tenant_id, user_id));
CREATE TABLE goal_issues (
 tenant_id uuid NOT NULL,
 goal_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 PRIMARY KEY (tenant_id, goal_id, issue_id),
 FOREIGN KEY (tenant_id, goal_id) REFERENCES goals(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);

-- H4. Capacity: hours a member can give to project work in a week.
CREATE TABLE member_capacity (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 hours_per_week numeric(4,1) NOT NULL CHECK (hours_per_week BETWEEN 0 AND 168),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, user_id),
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);

-- H6. Baselines: the due dates of a project at one moment, compared with later dates.
CREATE TABLE baselines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
CREATE TABLE baseline_items (
 tenant_id uuid NOT NULL,
 baseline_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 due_at timestamptz,
 PRIMARY KEY (tenant_id, baseline_id, issue_id),
 FOREIGN KEY (tenant_id, baseline_id) REFERENCES baselines(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['milestones','initiatives','initiative_epics','project_updates','goal_issues','member_capacity','baselines','baseline_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;
