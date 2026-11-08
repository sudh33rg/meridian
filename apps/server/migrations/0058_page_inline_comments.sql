-- 0058_page_inline_comments.sql
-- Confluence-style inline comments on selected page text

CREATE TABLE IF NOT EXISTS page_inline_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  page_id UUID NOT NULL,
  user_id UUID NOT NULL,
  selected_text TEXT NOT NULL,
  anchor_range JSONB NOT NULL DEFAULT '{}'::jsonb,
  content TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 5000),
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id, page_id) REFERENCES pages(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE(tenant_id, id)
);

ALTER TABLE page_inline_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY page_inline_comments_tenant ON page_inline_comments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS page_inline_comments_page_idx
  ON page_inline_comments(tenant_id, page_id, created_at);
