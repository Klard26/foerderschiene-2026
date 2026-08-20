-- Änderungsprotokoll der automatischen Förderprogramm-Aktualisierung.
CREATE TABLE IF NOT EXISTS foerder_update_log (
  id SERIAL PRIMARY KEY,
  gestartet_am TIMESTAMP NOT NULL DEFAULT NOW(),
  abgeschlossen_am TIMESTAMP,
  quelle TEXT NOT NULL,
  eingefuegt INTEGER NOT NULL DEFAULT 0,
  geaendert INTEGER NOT NULL DEFAULT 0,
  deaktiviert INTEGER NOT NULL DEFAULT 0,
  fehler TEXT
);
