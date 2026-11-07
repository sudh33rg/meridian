-- Webhook delivery: signed (Standard Webhooks), SSRF-safe, retried with backoff, dead-lettered,
-- rate limited per workspace. Deliveries are queued in the same transaction as the event.

ALTER TABLE webhooks ALTER COLUMN secret_hash DROP NOT NULL;
ALTER TABLE webhooks ADD COLUMN secret_sealed text;
ALTER TABLE webhooks ADD COLUMN events text[] NOT NULL DEFAULT '{}';        -- empty = every event
ALTER TABLE webhooks ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE webhooks ADD COLUMN disabled_reason text;
ALTER TABLE webhooks ADD COLUMN last_success_at timestamptz;
-- Webhooks registered before this migration have no recoverable secret; they stay off.
UPDATE webhooks SET enabled = false WHERE secret_sealed IS NULL;

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  webhook_id uuid NOT NULL,
  event_sync_id bigint,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'delivered', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  FOREIGN KEY (tenant_id, webhook_id) REFERENCES webhooks(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries(next_attempt_at) WHERE state IN ('pending', 'sending');
CREATE INDEX webhook_deliveries_hook_idx ON webhook_deliveries(tenant_id, webhook_id, created_at DESC);
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
-- Requests only append deliveries (inside the event's transaction); the dispatcher owns the rest.
REVOKE UPDATE, DELETE ON webhook_deliveries FROM meridian_app;
REVOKE UPDATE, DELETE, INSERT ON webhooks FROM meridian_app;
CREATE FUNCTION notify_webhook() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('webhooks', ''); RETURN NEW; END $$;
CREATE TRIGGER webhook_deliveries_notify AFTER INSERT ON webhook_deliveries FOR EACH ROW EXECUTE FUNCTION notify_webhook();
