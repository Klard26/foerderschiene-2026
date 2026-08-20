# Förderschiene

Eigenständiger Quellcode der Förderschiene-Plattform für Gebäudecheck, Förderprogramme, Gebäudereport, Energieausweise und Energieberater.

## Enthaltene Bestandteile

- `artifacts/foerderportal` – React/Vite-Frontend und öffentliche Ratgeber- bzw. Rechtstextseiten
- `artifacts/api-server` – Express-API, Bestellungen, Förderprogramme, Energieberater und Administration
- `lib/` – gemeinsame API-, Validierungs-, Datenbank- und Berechnungsbibliotheken
- `scripts/` – Daten- und Katalog-Werkzeuge
- `attached_assets/` – von der Anwendung verwendete Grafik

Der frühere eigenständige Resend-Maildienst ist bewusst nicht enthalten. Die API verwendet die direkte Replit-Resend-Integration. Keine Zugangsdaten oder lokalen Umgebungsdateien sind Teil dieses Repositorys.

## Lokale Entwicklung

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/foerderportal run dev
```

Benötigte Umgebungsvariablen werden nicht mitversioniert. Dazu gehören insbesondere die Datenbankverbindung, Clerk-Schlüssel, `SESSION_SECRET`, Stripe-Konfiguration und die Replit-Resend-Integration.

## Qualitätssicherung

```bash
pnpm run typecheck
pnpm run test
```
