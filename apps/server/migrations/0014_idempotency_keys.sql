-- Idempotency keys for create requests (Stripe-style `Idempotency-Key` header).
-- A successful create stores its response here, keyed by tenant, user, operation scope and the
-- client-supplied key, so a retried request (offline drafts, flaky networks, double clicks)
-- replays the original response instead of creating a duplicate. Failed requests are not stored,
-- so they can be retried safely. Rows are tenant-scoped and protected by row level security.
CREATE TABLE idempotency_keys (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid NOT NULL REFERENCES users(id),
 scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 200),
 key text NOT NULL CHECK (length(key) BETWEEN 8 AND 255),
 request_hash text NOT NULL,
 response_status integer NOT NULL,
 response_body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, user_id, scope, key));
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys(created_at);
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
