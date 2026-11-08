-- Phase F7 (transition validators and post-functions). A rule can require a workspace admin or owner
-- to make the change (a permission validator). Post-functions run in the same transaction as the
-- status change: set a custom field to a value, or notify the workspace admins. Per-transition
-- screens are not built.
ALTER TABLE status_transitions ADD COLUMN requires_admin boolean NOT NULL DEFAULT false;

CREATE TABLE transition_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 from_key text NOT NULL,
 to_key text NOT NULL,
 action text NOT NULL CHECK (action IN ('set_field', 'notify_admins')),
 field_key text,
 field_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((action = 'set_field') = (field_key IS NOT NULL)),
 CHECK (action = 'set_field' OR field_value IS NULL),
 FOREIGN KEY (tenant_id, project_id, from_key, to_key) REFERENCES status_transitions (tenant_id, project_id, from_key, to_key) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, project_id, field_key) REFERENCES field_definitions (tenant_id, project_id, key));
CREATE INDEX transition_actions_rule_idx ON transition_actions(tenant_id, project_id, from_key, to_key);
ALTER TABLE transition_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transition_actions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
