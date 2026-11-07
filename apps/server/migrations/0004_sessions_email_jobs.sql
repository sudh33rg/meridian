-- Phase 1: session families with refresh-token rotation, email lifecycle tokens, durable jobs.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
GRANT SELECT (email_verified_at) ON users TO meridian_app;

-- One family per sign-in (device/browser). Revoking a family kills its sessions and refresh tokens.
CREATE TABLE session_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX session_families_user_idx ON session_families(tenant_id, user_id) WHERE revoked_at IS NULL;

ALTER TABLE sessions ADD COLUMN family_id uuid;
ALTER TABLE sessions ADD CONSTRAINT sessions_family_fk FOREIGN KEY (tenant_id, family_id) REFERENCES session_families(tenant_id, id) ON DELETE CASCADE;
CREATE INDEX sessions_family_idx ON sessions(family_id);

-- Rotating refresh tokens. A token is single-use; presenting a used one revokes the whole family.
CREATE TABLE refresh_tokens (
  token_hash text PRIMARY KEY,
  family_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, family_id) REFERENCES session_families(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

-- Email verification / password reset. Only the hash is stored; the raw token is re-derived by
-- the mailer from (server secret, purpose, id), so it never sits in the database or the job queue.
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens(user_id, kind);

-- Durable background jobs (transactional enqueue, SKIP LOCKED claim, retry with backoff).
CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'dead')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs(run_at) WHERE state = 'queued';
CREATE INDEX jobs_running_idx ON jobs(locked_at) WHERE state = 'running';
CREATE FUNCTION notify_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('jobs', ''); RETURN NEW; END $$;
CREATE TRIGGER jobs_notify AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION notify_job();

-- Row level security for the new tenant-carrying tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['session_families', 'refresh_tokens', 'jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

-- Request transactions: families are manageable; refresh/email/credential tables are system-only;
-- jobs may only be enqueued (never read or altered) by requests.
REVOKE ALL ON refresh_tokens, auth_tokens FROM meridian_app;
REVOKE ALL ON jobs FROM meridian_app;
GRANT INSERT ON jobs TO meridian_app;
