-- 0056_oauth_apps_and_vcs_links.sql
-- OAuth 2.0 app registration and multi-VCS linking

CREATE TABLE IF NOT EXISTS oauth_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  redirect_uri TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{"read", "write"}',
  is_trusted BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, id)
);

ALTER TABLE oauth_apps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_apps_tenant ON oauth_apps;
CREATE POLICY oauth_apps_tenant ON oauth_apps
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_apps(client_id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE oauth_auth_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_auth_codes_tenant ON oauth_auth_codes;
CREATE POLICY oauth_auth_codes_tenant ON oauth_auth_codes
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_apps(client_id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_tokens_tenant ON oauth_tokens;
CREATE POLICY oauth_tokens_tenant ON oauth_tokens
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE dev_links ADD COLUMN IF NOT EXISTS vcs_provider TEXT NOT NULL DEFAULT 'github';
ALTER TABLE dev_links ADD COLUMN IF NOT EXISTS merge_status TEXT NOT NULL DEFAULT 'open';
