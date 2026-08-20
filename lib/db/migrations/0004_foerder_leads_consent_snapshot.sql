-- GDPR consent proof for Förderprogramm-Finder leads: snapshot the consent
-- version + exact wording server-side at submission time.
ALTER TABLE foerder_leads
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_text text;
