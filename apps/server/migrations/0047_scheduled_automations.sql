-- Scheduled automation rules (Phase I1). A scheduled rule runs its conditions over the open issues of
-- its project on a fixed cadence, with its creator's authority. Only custom rules can be scheduled.
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_trigger_event_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_trigger_event_check
  CHECK (trigger_event IN ('issue_created','issue_status_changed','issue_updated','comment_added','scheduled'));
ALTER TABLE automation_rules ADD COLUMN schedule text CHECK (schedule IN ('hourly', 'daily', 'weekly'));
ALTER TABLE automation_rules ADD COLUMN next_run_at timestamptz;
ALTER TABLE automation_rules ADD COLUMN last_run_at timestamptz;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_schedule_shape CHECK (
  trigger_event <> 'scheduled' OR (schedule IS NOT NULL AND action_type = 'custom'));
CREATE INDEX automation_rules_due_idx ON automation_rules (next_run_at) WHERE trigger_event = 'scheduled' AND enabled;
