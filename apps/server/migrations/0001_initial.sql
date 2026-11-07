CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, display_name text NOT NULL,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (
 tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
 PRIMARY KEY (tenant_id,user_id));
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,user_id) REFERENCES memberships(tenant_id,user_id));
CREATE INDEX sessions_user_idx ON sessions(user_id, expires_at);
CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 name text NOT NULL, key text NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
 description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,key), UNIQUE(tenant_id,id));
CREATE TABLE issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 project_id uuid NOT NULL, number bigint NOT NULL, title text NOT NULL,
 description text NOT NULL DEFAULT '', kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('task','bug','story','epic')),
 status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','in_review','done')),
 priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
 assignee_id uuid, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY (tenant_id,assignee_id) REFERENCES memberships(tenant_id,user_id),
 UNIQUE(project_id,number), UNIQUE(tenant_id,id));
CREATE INDEX issues_project_status_idx ON issues(tenant_id,project_id,status,updated_at DESC);
CREATE TABLE pages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 project_id uuid NOT NULL, parent_id uuid, title text NOT NULL, content text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY (tenant_id,parent_id) REFERENCES pages(tenant_id,id),
 UNIQUE(tenant_id,id));
CREATE INDEX pages_project_idx ON pages(tenant_id,project_id,updated_at DESC);
CREATE TABLE page_versions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL,
 page_id uuid NOT NULL, version integer NOT NULL, title text NOT NULL, content text NOT NULL,
 editor_id uuid NOT NULL REFERENCES users(id), saved_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,page_id) REFERENCES pages(tenant_id,id), UNIQUE(page_id,version));
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL,
 entity_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_tenant_time_idx ON audit_events(tenant_id,occurred_at DESC);
