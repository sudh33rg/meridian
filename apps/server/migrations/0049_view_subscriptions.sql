-- Saved-view subscriptions (Phase I2 leftover, Jira filter subscriptions). A member subscribes to one
-- saved view they can open and gets a daily or weekly notification with how many issues match it and
-- how many of those changed since the last one. The notification joins the inbox, so the existing
-- email digest carries it when the member has email on.
CREATE TABLE view_subscriptions (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  view_id uuid NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly')),
  next_run_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, view_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX view_subscriptions_due_idx ON view_subscriptions (next_run_at);
ALTER TABLE view_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON view_subscriptions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
