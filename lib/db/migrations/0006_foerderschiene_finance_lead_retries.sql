-- Keep failed finance-lead creation attempts durable so the API can retry them
-- after a transient webhook/database/network failure.
ALTER TABLE foerderschiene_reports
  ADD COLUMN IF NOT EXISTS finance_lead_retry_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS finance_lead_retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finance_lead_last_error TEXT;

CREATE INDEX IF NOT EXISTS foerderschiene_reports_finance_lead_retry_idx
  ON foerderschiene_reports (finance_lead_retry_at)
  WHERE finance_lead_retry_at IS NOT NULL;