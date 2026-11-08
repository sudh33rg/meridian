-- Phase E (backlogs, team scope, sprint execution, release scope, burndown).

-- 1. Ranked product backlog. Ranks are fractional so one item can move between two others without
--    renumbering the rest. Ranks belong to the project, not to the backlog, so an item that leaves a
--    sprint returns to the position it held.
ALTER TABLE issues ADD COLUMN backlog_rank double precision;
UPDATE issues i SET backlog_rank = r.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id, project_id ORDER BY created_at, number) AS rn FROM issues) r
  WHERE i.id = r.id;
ALTER TABLE issues ALTER COLUMN backlog_rank SET NOT NULL;

-- Every insert path (API, CSV import, JSON import, seeds) gets the bottom rank of its project.
CREATE FUNCTION issues_default_rank() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.backlog_rank IS NULL THEN
    SELECT COALESCE(MAX(backlog_rank), 0) + 1 INTO NEW.backlog_rank
      FROM issues WHERE tenant_id = NEW.tenant_id AND project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issues_default_rank BEFORE INSERT ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_default_rank();
CREATE INDEX issues_backlog_idx ON issues(tenant_id, project_id, backlog_rank)
  WHERE archived_at IS NULL AND sprint_id IS NULL;

-- 2. Team ownership. An issue belongs to at most one team; a sprint may belong to one team.
ALTER TABLE issues ADD COLUMN team_id uuid;
ALTER TABLE issues ADD CONSTRAINT issues_team_tenant_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id);
CREATE INDEX issues_team_idx ON issues(tenant_id, team_id) WHERE team_id IS NOT NULL;

ALTER TABLE sprints ADD COLUMN team_id uuid;
ALTER TABLE sprints ADD CONSTRAINT sprints_team_tenant_fk FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id);
-- One active sprint per team, and one active sprint for unassigned work in a project.
DROP INDEX sprints_one_active_per_project;
CREATE UNIQUE INDEX sprints_one_active_per_scope ON sprints(project_id, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE state = 'active';

-- 3. Sprint closing record. Written when a sprint starts and when it closes, so velocity and scope
--    creep never depend on issues that were edited later.
ALTER TABLE sprints ADD COLUMN started_scope_count integer;
ALTER TABLE sprints ADD COLUMN started_scope_points integer;
ALTER TABLE sprints ADD COLUMN closed_at timestamptz;
ALTER TABLE sprints ADD COLUMN final_scope_count integer;
ALTER TABLE sprints ADD COLUMN final_scope_points integer;
ALTER TABLE sprints ADD COLUMN final_done_count integer;
ALTER TABLE sprints ADD COLUMN final_done_points integer;
ALTER TABLE sprints ADD COLUMN carried_over_count integer;

-- 4. Daily burndown snapshots for sprints, written by the maintenance loop and at start and close.
CREATE TABLE sprint_daily_snapshots (
 tenant_id uuid NOT NULL,
 sprint_id uuid NOT NULL,
 day date NOT NULL,
 scope_count integer NOT NULL CHECK (scope_count >= 0),
 done_count integer NOT NULL CHECK (done_count >= 0),
 scope_points integer NOT NULL CHECK (scope_points >= 0),
 done_points integer NOT NULL CHECK (done_points >= 0),
 captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, sprint_id, day),
 FOREIGN KEY (tenant_id, sprint_id) REFERENCES sprints(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE sprint_daily_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sprint_daily_snapshots USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- 5. Release scope. Membership is a row with add and remove times, so the history of a release
--    (what was added, removed and when, relative to the scope freeze) is kept, not overwritten.
ALTER TABLE releases ADD COLUMN frozen_at timestamptz;
ALTER TABLE releases ADD COLUMN released_at timestamptz;

CREATE TABLE release_issues (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 release_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 added_by uuid NOT NULL REFERENCES users(id),
 added_at timestamptz NOT NULL DEFAULT now(),
 added_after_freeze boolean NOT NULL DEFAULT false,
 removed_by uuid REFERENCES users(id),
 removed_at timestamptz,
 removed_after_freeze boolean NOT NULL DEFAULT false,
 CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
 FOREIGN KEY (tenant_id, release_id) REFERENCES releases(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id));
CREATE UNIQUE INDEX release_issues_active ON release_issues(tenant_id, release_id, issue_id) WHERE removed_at IS NULL;
CREATE INDEX release_issues_issue_idx ON release_issues(tenant_id, issue_id) WHERE removed_at IS NULL;
ALTER TABLE release_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON release_issues USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
