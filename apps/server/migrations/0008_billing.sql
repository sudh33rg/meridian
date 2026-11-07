-- Billing: one subscription row per workspace (plan, status, Stripe linkage) and an idempotency
-- log for Stripe webhooks. Plan limits live in code (billing.rs); usage is counted live.

CREATE TABLE subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'team', 'business')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO subscriptions(tenant_id) SELECT id FROM tenants ON CONFLICT DO NOTHING;

CREATE TABLE billing_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
-- Requests may read their workspace's plan (to enforce limits); only the system connection writes it.
REVOKE INSERT, UPDATE, DELETE ON subscriptions FROM meridian_app;
REVOKE ALL ON billing_events FROM meridian_app;
