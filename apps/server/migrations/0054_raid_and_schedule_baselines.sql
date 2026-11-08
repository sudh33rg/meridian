-- 0054_raid_and_schedule_baselines.sql
-- Full RAID tracking and schedule baselines

CREATE TABLE IF NOT EXISTS raid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('risk', 'assumption', 'issue', 'dependency')),
  title TEXT NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'mitigated', 'resolved', 'closed')),
  owner_id UUID,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
  UNIQUE(tenant_id, id)
);

ALTER TABLE raid_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY raid_items_tenant ON raid_items
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS schedule_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  snapshot JSONB NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
  UNIQUE(tenant_id, id)
);

ALTER TABLE schedule_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedule_baselines_tenant ON schedule_baselines
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
