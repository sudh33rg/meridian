-- Enterprise identity: OIDC single sign-on, verified email domains, SCIM 2.0 provisioning.
-- All of these tables are managed through the system connection (admin endpoints scope every
-- query by the caller's tenant); request transactions cannot touch them.

CREATE TABLE sso_connections (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  client_id text NOT NULL,
  client_secret_sealed text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  default_role text NOT NULL DEFAULT 'member' CHECK (default_role IN ('member', 'viewer')),
  jit_provisioning boolean NOT NULL DEFAULT true,
  enforce_sso boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Authorization-request state: single use, short lived, bound to a nonce and a PKCE verifier.
CREATE TABLE sso_states (
  state_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  pkce_verifier_sealed text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE sso_identities (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, issuer, subject)
);
-- Email domains a workspace has proven it controls (DNS TXT or /.well-known file). Only verified
-- domains may be used for just-in-time provisioning, SSO linking and SCIM, and a domain can be
-- verified by one workspace only.
CREATE TABLE verified_domains (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  token text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, domain)
);
CREATE UNIQUE INDEX verified_domains_one_owner ON verified_domains(domain) WHERE verified_at IS NOT NULL;

CREATE TABLE scim_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE TABLE scim_external_ids (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  PRIMARY KEY (tenant_id, user_id),
  UNIQUE (tenant_id, external_id)
);
ALTER TABLE memberships ADD COLUMN provisioned_by text NOT NULL DEFAULT 'manual'
  CHECK (provisioned_by IN ('manual', 'sso', 'scim'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sso_connections','sso_states','sso_identities','verified_domains','scim_tokens','scim_external_ids'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('REVOKE ALL ON %I FROM meridian_app', t);
  END LOOP;
END $$;
