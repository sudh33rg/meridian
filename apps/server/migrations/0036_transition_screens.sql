-- Phase F7 (screens). A transition screen lists the custom fields shown when a move is made. The list
-- is ordered and capped at 20 fields by the handler. Screens follow the rule: deleting the rule or the
-- field removes the entries.
CREATE TABLE transition_screen_fields (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 from_key text NOT NULL,
 to_key text NOT NULL,
 field_key text NOT NULL,
 position integer NOT NULL CHECK (position >= 0),
 PRIMARY KEY (tenant_id, project_id, from_key, to_key, field_key),
 FOREIGN KEY (tenant_id, project_id, from_key, to_key) REFERENCES status_transitions (tenant_id, project_id, from_key, to_key) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, project_id, field_key) REFERENCES field_definitions (tenant_id, project_id, key) ON DELETE CASCADE);
ALTER TABLE transition_screen_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transition_screen_fields USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
