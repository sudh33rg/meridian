-- Per-action permission levels (Phase J1). A project scheme can require a level for named actions
-- (manage_sprints, manage_releases, delete_issues). Unset actions use the scheme's edit level, so
-- existing projects behave as before until an admin sets one.
ALTER TABLE project_permission_schemes ADD COLUMN action_levels jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(action_levels) = 'object');
