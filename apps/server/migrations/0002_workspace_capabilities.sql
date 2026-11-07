-- Meridian v0.2: tenant-scoped work, knowledge, planning and integration primitives.
-- All FK relationships involving tenant-owned entities use (tenant_id,id) to prevent cross-tenant references.
ALTER TABLE projects ADD COLUMN archived_at timestamptz;
ALTER TABLE issues ADD COLUMN parent_id uuid;
ALTER TABLE issues ADD COLUMN due_at timestamptz;
ALTER TABLE issues ADD COLUMN story_points integer CHECK (story_points BETWEEN 0 AND 1000);
ALTER TABLE issues ADD COLUMN labels text[] NOT NULL DEFAULT '{}';
ALTER TABLE issues ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE issues ADD COLUMN archived_at timestamptz;
ALTER TABLE issues ADD CONSTRAINT issues_parent_tenant_fk FOREIGN KEY (tenant_id,parent_id) REFERENCES issues(tenant_id,id);
ALTER TABLE pages ADD COLUMN status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE pages ADD COLUMN labels text[] NOT NULL DEFAULT '{}';
ALTER TABLE pages ADD COLUMN archived_at timestamptz;

CREATE TABLE invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 email text NOT NULL, role text NOT NULL CHECK (role IN ('admin','member','viewer')),
 token_hash text NOT NULL UNIQUE, invited_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,id));
CREATE INDEX invitations_tenant_idx ON invitations(tenant_id,created_at DESC);

CREATE TABLE teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL,description text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,name),UNIQUE(tenant_id,id));
CREATE TABLE team_members (
 tenant_id uuid NOT NULL,team_id uuid NOT NULL,user_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,team_id,user_id),
 FOREIGN KEY(tenant_id,team_id) REFERENCES teams(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id) ON DELETE CASCADE);

CREATE TABLE sprints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 name text NOT NULL,goal text NOT NULL DEFAULT '',state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','active','completed')),
 starts_at timestamptz,ends_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,id));
CREATE UNIQUE INDEX sprints_one_active_per_project ON sprints(project_id) WHERE state='active';
ALTER TABLE issues ADD COLUMN sprint_id uuid;
ALTER TABLE issues ADD CONSTRAINT issues_sprint_tenant_fk FOREIGN KEY(tenant_id,sprint_id) REFERENCES sprints(tenant_id,id);
CREATE INDEX issues_sprint_idx ON issues(tenant_id,sprint_id) WHERE sprint_id IS NOT NULL;

CREATE TABLE releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 name text NOT NULL,description text NOT NULL DEFAULT '',target_at timestamptz,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','released','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,id),UNIQUE(project_id,name));
CREATE TABLE issue_links (
 tenant_id uuid NOT NULL,source_id uuid NOT NULL,target_id uuid NOT NULL,
 relation text NOT NULL CHECK(relation IN ('blocks','relates','duplicates','depends_on')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,source_id,target_id,relation),CHECK(source_id<>target_id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES issues(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,target_id) REFERENCES issues(tenant_id,id) ON DELETE CASCADE);

CREATE TABLE issue_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,issue_id uuid NOT NULL,
 parent_id uuid,author_id uuid NOT NULL REFERENCES users(id),body text NOT NULL CHECK(length(body)>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,issue_id) REFERENCES issues(tenant_id,id) ON DELETE CASCADE,
 UNIQUE(tenant_id,id));
ALTER TABLE issue_comments ADD CONSTRAINT issue_comments_parent_fk FOREIGN KEY(tenant_id,parent_id) REFERENCES issue_comments(tenant_id,id);
CREATE INDEX issue_comments_target_idx ON issue_comments(tenant_id,issue_id,created_at DESC);
CREATE TABLE page_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,page_id uuid NOT NULL,
 author_id uuid NOT NULL REFERENCES users(id),body text NOT NULL CHECK(length(body)>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,page_id) REFERENCES pages(tenant_id,id) ON DELETE CASCADE);
CREATE INDEX page_comments_target_idx ON page_comments(tenant_id,page_id,created_at DESC);

CREATE TABLE goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 project_id uuid, title text NOT NULL,description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'on_track' CHECK(status IN ('on_track','at_risk','off_track','done')),
 progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 target_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,id));
CREATE TABLE decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 title text NOT NULL,context text NOT NULL DEFAULT '',outcome text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','superseded')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,id));
CREATE TABLE risks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 title text NOT NULL,mitigation text NOT NULL DEFAULT '',
 likelihood integer NOT NULL DEFAULT 2 CHECK(likelihood BETWEEN 1 AND 5),
 impact integer NOT NULL DEFAULT 2 CHECK(impact BETWEEN 1 AND 5),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','mitigated','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,id));

CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
 recipient_id uuid NOT NULL,actor_id uuid,kind text NOT NULL,title text NOT NULL,body text NOT NULL DEFAULT '',
 entity_type text,entity_id uuid,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,recipient_id) REFERENCES memberships(tenant_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id));
CREATE INDEX notifications_unread_idx ON notifications(tenant_id,recipient_id,created_at DESC) WHERE read_at IS NULL;

CREATE TABLE automation_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 name text NOT NULL,enabled boolean NOT NULL DEFAULT true,
 trigger_event text NOT NULL CHECK(trigger_event IN ('issue_created','issue_status_changed')),
 action_type text NOT NULL CHECK(action_type IN ('notify_project_admins','set_priority_high')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,id));
CREATE TABLE automation_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL,rule_id uuid NOT NULL,
 entity_id uuid NOT NULL,result text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,rule_id) REFERENCES automation_rules(tenant_id,id));

CREATE TABLE webhooks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL,url text NOT NULL,secret_hash text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id));
CREATE TABLE outbox_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),
 event_type text NOT NULL,entity_id uuid NOT NULL,payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz);
CREATE INDEX outbox_pending_idx ON outbox_events(id) WHERE processed_at IS NULL;

CREATE INDEX issues_tenant_due_idx ON issues(tenant_id,due_at) WHERE archived_at IS NULL;
CREATE INDEX issues_search_title_idx ON issues USING gin(to_tsvector('simple', title || ' ' || description));
CREATE INDEX pages_search_content_idx ON pages USING gin(to_tsvector('simple',title || ' ' || content));
CREATE INDEX goals_project_idx ON goals(tenant_id,project_id);
CREATE INDEX audit_entity_idx ON audit_events(tenant_id,entity_type,entity_id);

CREATE TABLE imported_issue_refs (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,external_ref text NOT NULL,issue_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,project_id,external_ref),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,issue_id) REFERENCES issues(tenant_id,id));

CREATE TABLE login_attempts (
 tenant_slug text NOT NULL,email text NOT NULL,failures integer NOT NULL DEFAULT 0,
 last_attempt timestamptz NOT NULL DEFAULT now(),blocked_until timestamptz,
 PRIMARY KEY(tenant_slug,email));

CREATE TABLE entity_relations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 source_type text NOT NULL CHECK(source_type IN ('issue','page','goal','decision','risk','release')),
 source_id uuid NOT NULL,target_type text NOT NULL CHECK(target_type IN ('issue','page','goal','decision','risk','release')),
 target_id uuid NOT NULL,relation text NOT NULL DEFAULT 'references' CHECK(relation IN ('references','implements','documents','depends_on','verifies')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_id<>target_id),UNIQUE(tenant_id,source_type,source_id,target_type,target_id,relation));
CREATE INDEX entity_relations_source_idx ON entity_relations(tenant_id,source_type,source_id);
CREATE INDEX entity_relations_target_idx ON entity_relations(tenant_id,target_type,target_id);

CREATE TABLE approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 title text NOT NULL,subject_type text NOT NULL CHECK(subject_type IN ('issue','page','decision')),
 subject_id uuid NOT NULL,requester_id uuid NOT NULL,reviewer_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 note text NOT NULL DEFAULT '',decided_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES memberships(tenant_id,user_id),
 FOREIGN KEY(tenant_id,reviewer_id) REFERENCES memberships(tenant_id,user_id),UNIQUE(tenant_id,id));
CREATE INDEX approvals_inbox_idx ON approvals(tenant_id,reviewer_id,status,created_at DESC);

ALTER TABLE memberships ADD COLUMN disabled_at timestamptz;
CREATE INDEX memberships_active_idx ON memberships(tenant_id,user_id) WHERE disabled_at IS NULL;
