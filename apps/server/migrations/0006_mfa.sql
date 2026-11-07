-- Phase 2 / security: multi-factor authentication (TOTP + recovery codes) and a workspace policy.

CREATE TABLE user_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret_sealed text NOT NULL,        -- AES-256-GCM sealed with a key derived from APP_SECRET
  confirmed_at timestamptz,                -- NULL while enrolment is pending
  last_used_step bigint NOT NULL DEFAULT 0, -- 30 s time step of the last accepted code (replay guard)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mfa_recovery_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  UNIQUE (user_id, code_hash)
);
-- Pending second step after a correct password. Only the hash of the token is stored.
CREATE TABLE mfa_challenges (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_agent text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_expiry_idx ON mfa_challenges(expires_at);

ALTER TABLE tenants ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;
-- How the sign-in was proven ('password', 'sso'); SSO relies on the identity provider's MFA.
ALTER TABLE session_families ADD COLUMN auth_method text NOT NULL DEFAULT 'password';

-- Credential material is never reachable from request transactions.
REVOKE ALL ON user_mfa, mfa_recovery_codes, mfa_challenges FROM meridian_app;
GRANT SELECT (id, slug, name, created_at, require_mfa) ON tenants TO meridian_app;
