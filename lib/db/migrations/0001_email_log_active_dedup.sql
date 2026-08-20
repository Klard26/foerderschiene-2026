-- Prevents two concurrent callers from double-sending the same transactional
-- email.  Only 'in_flight' and 'sent' rows participate in the constraint;
-- 'failed' and 'skipped' rows are excluded so a retried send can claim a fresh
-- slot after a prior attempt was logged as failed.
--
-- The 'in_flight' status functions as a durable lease: whichever process wins
-- the INSERT owns the delivery slot.  Any concurrent caller that loses the race
-- gets DO NOTHING (or DO UPDATE only for stale, crashed-process leases).
-- After a successful Resend call the row is transitioned to 'sent'.
CREATE UNIQUE INDEX IF NOT EXISTS email_log_active_dedup
  ON email_log (template_id, related_id)
  WHERE status IN ('in_flight', 'sent');
