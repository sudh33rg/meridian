-- Phase J2 (restricted fields). A restricted custom field is seen and changed by project admins only.
-- Members do not see its values in issue details or history, cannot change it, and cannot search on it.
ALTER TABLE field_definitions ADD COLUMN restricted boolean NOT NULL DEFAULT false;
