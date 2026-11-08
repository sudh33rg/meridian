-- Phase K2 (completion). A request type can need approval from a named member, and can show a form:
-- an ordered list of the project's custom fields, some required. A request that passes its target
-- without a done status is escalated once, when the maintenance loop finds it.
ALTER TABLE request_types ADD COLUMN requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE request_types ADD COLUMN approver_id uuid;
ALTER TABLE request_types ADD CONSTRAINT request_types_approver_fk FOREIGN KEY (tenant_id, approver_id)
 REFERENCES memberships(tenant_id, user_id) ON DELETE SET NULL (approver_id);
ALTER TABLE request_types ADD CONSTRAINT request_types_approval_needs_approver CHECK (NOT requires_approval OR approver_id IS NOT NULL);

CREATE TABLE request_type_fields (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 request_type_id uuid NOT NULL,
 field_key text NOT NULL,
 position integer NOT NULL CHECK (position >= 0),
 required boolean NOT NULL DEFAULT false,
 PRIMARY KEY (tenant_id, request_type_id, field_key),
 FOREIGN KEY (tenant_id, request_type_id) REFERENCES request_types(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, project_id, field_key) REFERENCES field_definitions(tenant_id, project_id, key) ON DELETE CASCADE);
ALTER TABLE request_type_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON request_type_fields USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE issues ADD COLUMN escalated_at timestamptz;
