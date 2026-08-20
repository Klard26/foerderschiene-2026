-- Förderprogramm-Finder leads (public quick-check wizard → AI analysis email).
-- Applied automatically at api-server startup via lib/db/src/runMigrations.ts.
CREATE TABLE IF NOT EXISTS foerder_leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  telefon TEXT,
  eingaben JSONB NOT NULL,
  programm_analyse TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  consent_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
