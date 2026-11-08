-- Phase K3 (knowledge structure). A blog post is a page that is also listed in the project's blog. A
-- project can name one of its pages as its home page. Page parents are changed through the API, which
-- refuses cycles.
CREATE TABLE blog_posts (
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 page_id uuid NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, page_id),
 FOREIGN KEY (tenant_id, page_id) REFERENCES pages(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE);
CREATE INDEX blog_posts_project_idx ON blog_posts(tenant_id, project_id, published_at DESC);
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON blog_posts USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE projects ADD COLUMN home_page_id uuid;
ALTER TABLE projects ADD CONSTRAINT projects_home_page_fk FOREIGN KEY (tenant_id, home_page_id)
 REFERENCES pages(tenant_id, id) ON DELETE SET NULL (home_page_id);
