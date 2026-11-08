-- 0053_issue_type_workflows_and_field_contexts.sql
-- Phase S1 & S2: Workflows and field contexts per issue type

CREATE TABLE IF NOT EXISTS issue_type_transitions (
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  issue_type_key TEXT NOT NULL,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  requires_field TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, project_id, issue_type_key, from_key, to_key),
  CHECK (from_key <> to_key),
  FOREIGN KEY (tenant_id, project_id, issue_type_key) REFERENCES issue_types (tenant_id, project_id, key) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id, from_key) REFERENCES project_statuses (tenant_id, project_id, key) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id, to_key) REFERENCES project_statuses (tenant_id, project_id, key) ON DELETE CASCADE
);

ALTER TABLE issue_type_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY issue_type_transitions_tenant ON issue_type_transitions
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS field_contexts (
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  issue_type_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  hidden BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, project_id, issue_type_key, field_key),
  FOREIGN KEY (tenant_id, project_id, issue_type_key) REFERENCES issue_types (tenant_id, project_id, key) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id, field_key) REFERENCES field_definitions (tenant_id, project_id, key) ON DELETE CASCADE
);

ALTER TABLE field_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY field_contexts_tenant ON field_contexts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
