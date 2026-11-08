-- Phase D (custom fields): each project defines typed custom fields that issues can carry in
-- issues.custom_fields. A field's key is fixed once created; its label, options, requirement and
-- order can change. Its type cannot change, so stored values stay valid.
CREATE TABLE field_definitions (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,31}$'),
 label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
 field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
 options text[] NOT NULL DEFAULT '{}',
 required boolean NOT NULL DEFAULT false,
 position integer NOT NULL CHECK (position >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, project_id, key),
 UNIQUE (tenant_id, project_id, position) DEFERRABLE INITIALLY DEFERRED,
 CHECK (field_type = 'select' OR cardinality(options) = 0),
 CHECK (field_type <> 'select' OR cardinality(options) BETWEEN 1 AND 50),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON field_definitions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
