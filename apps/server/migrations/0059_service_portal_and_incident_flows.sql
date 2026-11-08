-- 0059_service_portal_and_incident_flows.sql
-- Customer portal and ITIL incident/change management

CREATE TABLE IF NOT EXISTS service_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  issue_id UUID NOT NULL,
  severity TEXT NOT NULL DEFAULT 'sev-2' CHECK (severity IN ('sev-0', 'sev-1', 'sev-2', 'sev-3')),
  impact TEXT NOT NULL DEFAULT 'minor' CHECK (impact IN ('minor', 'major', 'critical')),
  root_cause TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE,
  UNIQUE(tenant_id, id)
);

ALTER TABLE service_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_incidents_tenant ON service_incidents
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS portal_settings (
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  portal_name TEXT NOT NULL DEFAULT 'Customer Support Portal',
  portal_enabled BOOLEAN NOT NULL DEFAULT true,
  welcome_message TEXT NOT NULL DEFAULT 'Welcome to our service desk. How can we help you today?',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, project_id),
  FOREIGN KEY(tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE portal_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_settings_tenant ON portal_settings
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
