-- Migration 0006 created mfa_challenges with a tenant_id column but without row level security.
-- The startup guard caught it; enable the standard policy (the table stays system-only).
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mfa_challenges USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
