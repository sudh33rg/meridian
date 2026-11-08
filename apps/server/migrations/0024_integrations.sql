-- Phase I (integrations and automation).

-- I5. Personal API tokens. The secret is shown once; only its SHA-256 is stored. A `read` token can
-- call GET endpoints only; a `write` token has the same reach as its owner's session.
CREATE TABLE api_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 token_hash text NOT NULL UNIQUE,
 prefix text NOT NULL,
 scope text NOT NULL DEFAULT 'read' CHECK (scope IN ('read','write')),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz,
 expires_at timestamptz,
 revoked_at timestamptz,
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_tokens USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- I4. Git linking. Each project has a secret that signs inbound repository events. Only the sealed
-- form is stored. Links are created when a commit or pull request names an issue key of the project.
CREATE TABLE project_git_secrets (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 secret_sealed text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, project_id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
CREATE TABLE dev_links (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('commit','pull_request')),
 ref text NOT NULL CHECK (length(ref) BETWEEN 1 AND 200),
 title text NOT NULL DEFAULT '' CHECK (length(title) <= 500),
 url text NOT NULL DEFAULT '' CHECK (length(url) <= 2000),
 author text NOT NULL DEFAULT '' CHECK (length(author) <= 200),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, issue_id, kind, ref),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE project_git_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_git_secrets USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE dev_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dev_links USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- I1. Automation rules: several conditions and several actions per rule. Rules created before this
-- migration keep their single legacy action. New rules use action_type 'custom' and store actions.
ALTER TABLE automation_rules ADD COLUMN conditions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE automation_rules ADD COLUMN actions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_event_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_event_check
  CHECK (trigger_event IN ('issue_created','issue_status_changed','issue_updated','comment_added'));
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_action_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_action_type_check
  CHECK (action_type IN ('notify_project_admins','set_priority_high','custom'));
