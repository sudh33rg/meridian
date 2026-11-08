-- 0052_sprint_reports_burnup_capacity.sql
-- Sprint member capacities and tracking

CREATE TABLE IF NOT EXISTS sprint_capacities (
  tenant_id UUID NOT NULL,
  sprint_id UUID NOT NULL,
  user_id UUID NOT NULL,
  capacity_hours NUMERIC(6, 2) NOT NULL DEFAULT 40.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, sprint_id, user_id),
  FOREIGN KEY (tenant_id, sprint_id) REFERENCES sprints(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);

ALTER TABLE sprint_capacities ENABLE ROW LEVEL SECURITY;

CREATE POLICY sprint_capacities_tenant ON sprint_capacities
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_sprint_capacities_sprint
  ON sprint_capacities(tenant_id, sprint_id);
