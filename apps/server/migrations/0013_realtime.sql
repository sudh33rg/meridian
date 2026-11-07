-- Real-time: the change feed (SSE) and collaborative page editing (Yjs).

-- Events carry the project they belong to so the feed can be filtered by access per subscriber.
ALTER TABLE events ADD COLUMN project_id uuid;
CREATE INDEX events_feed_idx ON events(tenant_id, sync_id) INCLUDE (entity_type, project_id);
CREATE FUNCTION notify_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('events', NEW.tenant_id::text); RETURN NEW; END $$;
CREATE TRIGGER events_notify AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION notify_event();

-- Collaborative documents: the Yjs update log is the source of truth while a page is being edited;
-- pages.content is a plain-text snapshot kept for search, export, history and the mobile reader.
-- collab_epoch is bumped whenever the content is replaced from outside the editor (REST save,
-- restore), which resets live rooms.
ALTER TABLE pages ADD COLUMN collab_epoch integer NOT NULL DEFAULT 0;
CREATE TABLE page_ydoc_updates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL,
  epoch integer NOT NULL,
  update bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, page_id) REFERENCES pages(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX page_ydoc_updates_page_idx ON page_ydoc_updates(page_id, id);
ALTER TABLE page_ydoc_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON page_ydoc_updates USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
-- The collaboration server (system connection) writes; requests may only clear it (REST save/restore).
REVOKE ALL ON page_ydoc_updates FROM meridian_app;
GRANT DELETE ON page_ydoc_updates TO meridian_app;
