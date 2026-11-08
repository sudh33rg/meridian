-- Phase F7 (post-functions, second build): two more post-functions run in the status change's
-- transaction. notify_assignee tells the issue's assignee. create_subtask creates a subtask whose
-- title the rule holds in `title`. The action shapes change, so the CHECK constraints from 0029 are
-- replaced: they are dropped by lookup because their generated names are not stable.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'transition_actions'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE transition_actions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE transition_actions ADD COLUMN title text;
ALTER TABLE transition_actions ADD CONSTRAINT transition_actions_shape CHECK (
 (action = 'set_field' AND field_key IS NOT NULL AND title IS NULL)
 OR (action = 'create_subtask' AND title IS NOT NULL AND length(btrim(title)) BETWEEN 1 AND 255
     AND field_key IS NULL AND field_value IS NULL)
 OR (action IN ('notify_admins', 'notify_assignee') AND field_key IS NULL AND field_value IS NULL AND title IS NULL));
