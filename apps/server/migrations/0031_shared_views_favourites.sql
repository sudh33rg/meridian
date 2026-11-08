-- Phase F8: saved views can be shared with the project; members keep their own favourites and a
-- short list of recently opened issues. Favourites and recent items are private to their member:
-- the handlers filter on user_id, and row level security keeps them inside the tenant.
ALTER TABLE saved_views ADD COLUMN shared boolean NOT NULL DEFAULT false;

CREATE TABLE issue_favourites (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, user_id, issue_id),
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);
ALTER TABLE issue_favourites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_favourites USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

CREATE TABLE issue_recent (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 viewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, user_id, issue_id),
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE);
CREATE INDEX issue_recent_member_idx ON issue_recent(tenant_id, user_id, viewed_at DESC);
ALTER TABLE issue_recent ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_recent USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
