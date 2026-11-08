-- Phase F5 (issue content). Members react to comments with a fixed set of reactions, and set personal
-- reminders on issues. A reminder is delivered as a notification by the maintenance loop.
-- issue_comments already has UNIQUE (tenant_id, id), so the reactions can reference it.
CREATE TABLE issue_comment_reactions (
 tenant_id uuid NOT NULL,
 comment_id uuid NOT NULL,
 user_id uuid NOT NULL,
 reaction text NOT NULL CHECK (reaction IN ('thumbs_up', 'party', 'eyes', 'heart', 'rocket', 'check')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, comment_id, user_id, reaction),
 FOREIGN KEY (tenant_id, comment_id) REFERENCES issue_comments(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
ALTER TABLE issue_comment_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_comment_reactions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

CREATE TABLE issue_reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 issue_id uuid NOT NULL,
 user_id uuid NOT NULL,
 remind_at timestamptz NOT NULL,
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, issue_id) REFERENCES issues(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE);
CREATE INDEX issue_reminders_due_idx ON issue_reminders(remind_at) WHERE sent_at IS NULL;
ALTER TABLE issue_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_reminders USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
