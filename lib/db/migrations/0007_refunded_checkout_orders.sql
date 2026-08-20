ALTER TABLE foerderschiene_reports
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

ALTER TABLE energieausweis_orders
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

ALTER TABLE gebaeudecheck_orders
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS foerderschiene_reports_payment_intent_idx
  ON foerderschiene_reports (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS energieausweis_orders_payment_intent_idx
  ON energieausweis_orders (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gebaeudecheck_orders_payment_intent_idx
  ON gebaeudecheck_orders (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;