-- Phase I3 (chat) and M1 (AI). A project can post status changes and new issues to a Slack and/or a
-- Microsoft Teams incoming webhook. The URLs are secrets: they are stored sealed, never returned, and only
-- project admins set them. Chat is off until configured. Deliveries are counted for a per-project quota.
CREATE TABLE project_chat_channels (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 slack_url_sealed text,
 teams_url_sealed text,
 slack_enabled boolean NOT NULL DEFAULT false,
 teams_enabled boolean NOT NULL DEFAULT false,
 notify_status_changes boolean NOT NULL DEFAULT true,
 notify_new_issues boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, project_id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
 CHECK (NOT slack_enabled OR slack_url_sealed IS NOT NULL),
 CHECK (NOT teams_enabled OR teams_url_sealed IS NOT NULL));
ALTER TABLE project_chat_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_chat_channels USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

CREATE TABLE chat_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX chat_deliveries_quota_idx ON chat_deliveries(tenant_id, project_id, sent_at);
ALTER TABLE chat_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chat_deliveries USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- M1 (AI). Off by default. A workspace admin turns it on; summaries and triage then send the project's
-- text (issues, comments, and other open issue titles the caller can see) to the configured model.
CREATE TABLE workspace_ai_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 enabled boolean NOT NULL DEFAULT false,
 changed_by uuid REFERENCES users(id),
 changed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_ai_settings USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
