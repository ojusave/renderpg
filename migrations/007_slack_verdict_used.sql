ALTER TABLE slack_verdicts DROP CONSTRAINT IF EXISTS slack_verdicts_status_check;
ALTER TABLE slack_verdicts DROP CONSTRAINT IF EXISTS slack_verdicts_pending_check;

ALTER TABLE slack_verdicts ADD CONSTRAINT slack_verdicts_status_check
  CHECK (status IN ('pending', 'rejected', 'used'));

ALTER TABLE slack_verdicts ADD CONSTRAINT slack_verdicts_pending_check CHECK (
  (usable AND status IN ('pending', 'used')) OR (NOT usable AND status = 'rejected')
);
