ALTER TABLE gebaeudecheck_orders
  ADD COLUMN IF NOT EXISTS credits_deducted INTEGER NOT NULL DEFAULT 0;
