-- Phase 1 / foundation: database-enforced tenant isolation and the per-tenant event log.
--
-- Model: the API connects as the migration/owner role ("system" connection: sign-in, session
-- lookup, cross-workspace flows, background jobs). Every authenticated request runs in ONE
-- transaction that does `SET LOCAL ROLE meridian_app` and sets `app.tenant_id`; row level security
-- then confines that transaction to a single tenant even if a handler forgets a predicate.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meridian_app') THEN
    CREATE ROLE meridian_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  -- The connecting role must be allowed to SET ROLE to it (a no-op for superusers).
  EXECUTE format('GRANT meridian_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'could not grant meridian_app to %: %', current_user, SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Per-tenant gap-free change sequence + append-only event log (the "sync_id" backbone).
CREATE TABLE tenant_counters (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  last_sync_id bigint NOT NULL DEFAULT 0
);
CREATE TABLE events (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sync_id bigint NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  op text NOT NULL,
  actor_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sync_id)
);
CREATE INDEX events_entity_idx ON events(tenant_id, entity_type, entity_id, sync_id DESC);

-- Privileges for the request role.
GRANT USAGE ON SCHEMA public TO meridian_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO meridian_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meridian_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meridian_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO meridian_app;
-- Credentials and bookkeeping tables are never reachable from request transactions.
REVOKE ALL ON users, login_attempts, _sqlx_migrations FROM meridian_app;
GRANT SELECT (id, email, display_name, created_at) ON users TO meridian_app;
-- Audit and event history is append-only for the application.
REVOKE UPDATE, DELETE ON audit_events, events FROM meridian_app;

-- Row level security on every table that carries tenant_id.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables x
      ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

-- A request may read (never write) its own tenant row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_read ON tenants FOR SELECT USING (id = app_tenant());
REVOKE INSERT, UPDATE, DELETE ON tenants FROM meridian_app;
