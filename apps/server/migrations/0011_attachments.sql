-- File attachments on issues and pages. The bytes live in object storage (never in Postgres);
-- this table holds metadata, the detected type, a content hash and the malware-scan state.

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('issue', 'page')),
  entity_id uuid NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'infected', 'skipped', 'error')),
  scan_detail text,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX attachments_entity_idx ON attachments(tenant_id, entity_type, entity_id, created_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachments USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
-- Requests may add and soft-delete; scan results are written by the worker (system connection).
REVOKE DELETE ON attachments FROM meridian_app;
REVOKE UPDATE ON attachments FROM meridian_app;
GRANT UPDATE (deleted_at) ON attachments TO meridian_app;
