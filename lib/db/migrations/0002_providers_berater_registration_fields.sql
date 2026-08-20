-- Energieberater self-registration: BAFA number and weekly capacity on providers.
-- Idempotent; also applied at startup via runMigrations.
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS bafa_nummer text,
  ADD COLUMN IF NOT EXISTS kapazitaet_stunden_pro_woche integer;
