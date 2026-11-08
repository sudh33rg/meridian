-- 0060_opentelemetry_and_ai_drafts.sql
-- OpenTelemetry traces export and governed AI drafting

CREATE TABLE IF NOT EXISTS trace_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'INTERNAL',
  status_code TEXT NOT NULL DEFAULT 'OK',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, id)
);

ALTER TABLE trace_spans ENABLE ROW LEVEL SECURITY;
CREATE POLICY trace_spans_tenant ON trace_spans
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS ai_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  draft_type TEXT NOT NULL CHECK (draft_type IN ('description', 'acceptance_criteria', 'retro_notes', 'release_summary')),
  prompt TEXT NOT NULL,
  output TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
  UNIQUE(tenant_id, id)
);

ALTER TABLE ai_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_drafts_tenant ON ai_drafts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
