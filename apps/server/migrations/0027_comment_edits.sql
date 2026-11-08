-- Phase F5 (issue content): comments can be edited by their author and deleted by the author or a
-- workspace admin. Nothing is lost silently: every earlier text of a comment is kept in
-- issue_comment_revisions, and a deleted comment keeps its text there and leaves the thread.
ALTER TABLE issue_comments ADD COLUMN edited_at timestamptz;
ALTER TABLE issue_comments ADD COLUMN deleted_at timestamptz;

CREATE TABLE issue_comment_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 comment_id uuid NOT NULL,
 body text NOT NULL CHECK (length(body) > 0),
 author_id uuid NOT NULL REFERENCES users(id),
 changed_by uuid NOT NULL REFERENCES users(id),
 change text NOT NULL CHECK (change IN ('edit', 'delete')),
 changed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id, comment_id) REFERENCES issue_comments(tenant_id, id) ON DELETE CASCADE);
CREATE INDEX issue_comment_revisions_comment_idx ON issue_comment_revisions(tenant_id, comment_id, changed_at);
ALTER TABLE issue_comment_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_comment_revisions USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
