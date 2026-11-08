-- Phase F9 (boards): a status column can have a work-in-progress limit. Moving an issue into a full
-- column is refused with a reason on every write path that changes status. Creating an issue in a
-- full column is not refused.
ALTER TABLE project_statuses ADD COLUMN wip_limit integer CHECK (wip_limit IS NULL OR wip_limit BETWEEN 1 AND 1000);
