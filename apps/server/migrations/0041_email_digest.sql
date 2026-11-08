-- Phase I2 (email and digests). A member can opt in to a daily email digest of unread notifications.
-- Off by default. Sending also needs the server setting EMAIL_NOTIFICATIONS=true and an SMTP_URL.
CREATE TABLE email_digest_settings (
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 last_sent_at timestamptz,
 PRIMARY KEY (tenant_id, user_id),
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
ALTER TABLE email_digest_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_digest_settings USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
