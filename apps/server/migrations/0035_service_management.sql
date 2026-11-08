-- Phase K2 (service management). A queue is where requests wait. Its default assignee is the
-- assignment rule: every request routed to the queue is assigned to that member. A request type says
-- which queue takes it, which flow it follows (request, incident or change) and how many hours the
-- request has to be resolved in. A request is an issue with a request type. Its SLA timer runs from
-- its first status row to the first move into a done status, read from issue_status_history.
CREATE TABLE service_queues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 default_assignee_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, project_id, name),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, default_assignee_id) REFERENCES memberships(tenant_id, user_id) ON DELETE SET NULL (default_assignee_id));
ALTER TABLE service_queues ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_queues USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

CREATE TABLE request_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
 description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
 flow text NOT NULL DEFAULT 'request' CHECK (flow IN ('request', 'incident', 'change')),
 queue_id uuid NOT NULL,
 target_hours integer NOT NULL CHECK (target_hours BETWEEN 1 AND 8760),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, project_id, name),
 UNIQUE (tenant_id, id),
 FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, queue_id) REFERENCES service_queues(tenant_id, id));
ALTER TABLE request_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON request_types USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE issues ADD COLUMN request_type_id uuid;
ALTER TABLE issues ADD CONSTRAINT issues_request_type_fk FOREIGN KEY (tenant_id, request_type_id) REFERENCES request_types(tenant_id, id);
CREATE INDEX issues_request_type_idx ON issues(tenant_id, request_type_id) WHERE request_type_id IS NOT NULL;
