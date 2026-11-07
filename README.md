# GitHub Universe

Aktuell trendende GitHub-Repositories als erkundbares Weltall. Die Seite richtet sich an Entwickler und an Nicht-Techniker gleichermaßen.

| Visuell | Bedeutung |
| --- | --- |
| Galaxie / Farbe | Kategorie (KI/LLM, DevTools, Web, Security, Data, Mobile, Infra, Games, Sonstiges) |
| Planetengröße | Stars gesamt (logarithmisch) |
| Leuchten | Star-Wachstum im gewählten Zeitraum (24 h / 7 Tage / 30 Tage) |

Aufbau:

- **`/` Landingpage:** Echtzeit-WebGL-Weltall mit prozeduralem Nebel, Milchstraßenband, Sternen in mehreren Parallax-Ebenen und einem Planeten mit Atmosphäre, dazu die aktuellen Aufsteiger, Kennzahlen und die neun Galaxien.
- **`/explore` Explorer:** die interaktive Karte. Planeten und Galaxie-Nebel sind prozedural schattierte Sprites (Wolkenbänder, Tag-Nacht-Grenze, Atmosphärensaum), der WebGL-Hintergrund folgt dem Verschieben mit Parallax.

Funktionen im Explorer:

- **Weltall-Ansicht:** Zoom und Pan per Maus, Trackpad und Touch. Beim Hovern erscheinen Name und Kurzinfo.
- **Listen-Ansicht:** sortierbar nach Stars, Wachstum und Name.
- **Filter:** Suche, Kategorie und Sprache.
- **Detail-Panel:** Seitenleiste am Desktop, Bottom-Sheet am Handy. Es enthält:
  - eine Erklärung in einfacher Sprache
  - einen Technik-Block
  - eine Vertrauens-Ampel
  - einen kopierbaren Install-Befehl
  - Links zu Codespaces, GitHub und der Website
- **Teilbare URLs:** zum Beispiel `/explore?period=24h&view=list&repo=ollama/ollama` oder `/explore?cat=ai`.

## Architektur

```
Vercel Cron (stündlich) ──► /api/cron/refresh ──► GitHub GraphQL  (Kandidaten, Metadaten, Stargazer-Zeitstempel)
                                   │             ├► npm / PyPI / crates.io (Paketname verifizieren)
                                   │             └► Claude (nur neue Repos: Kategorie + 2-Satz-Erklärung)
                                   ▼
                     Vercel Blob: snapshot.json · enriched.json · history.json
                                   ▼
Browser ──► / und /api/universe?period=24h|7d|30d  (liest NUR den Snapshot, 5 min gecacht)
```

- **Nutzer-Anfragen lösen nie Quell-APIs aus.** Die Seite und `/api/universe` lesen ausschließlich den gespeicherten Snapshot. Dafür sorgen `"use cache"` mit `cacheLife` sowie `Cache-Control: s-maxage=300`.
- **Robustheit:** Schlägt der Cron-Lauf fehl (Rate-Limit, API-Fehler), wird der alte Snapshot nicht überschrieben. Ein Snapshot mit weniger als 20 Repos wird verworfen. Beim Lesen gilt diese Reihenfolge:
  1. gespeicherter Snapshot
  2. letzter gültiger Snapshot im Speicher
  3. `data/fallback.json` (120 bekannte Repos mit echten Zahlen, ohne Wachstumsdaten)

### Warum nicht OSSInsight?

Die ursprünglich geplante Quelle `api.ossinsight.io/v1/trends/repos` liefert **seit dem 1. März 2026 leere Ergebnisse**. Die API meldet dazu selbst `"status": "unavailable"`, weil ihre Event-Erfassung auf etwa 0,3 % eingebrochen ist. Das gilt auch für die Collection-Rankings.

Trend und Wachstum werden deshalb direkt über die GitHub-API ermittelt:

1. **Kandidaten** kommen aus der GitHub-Suche, zum Beispiel „in den letzten 30 Tagen erstellt, nach Stars sortiert“, junge aktive Repos je Kategorie-Topic und die Repos aus dem letzten Snapshot.
2. **Das Wachstum** wird genau gezählt, und zwar über `stargazers(orderBy: STARRED_AT DESC)` mit `starredAt`-Zeitstempeln. Pro Repo werden höchstens 400 Stars gelesen.
3. Reicht das nicht 30 Tage zurück, wird die **eigene Snapshot-Historie** genutzt (Star-Differenz, stündlich bzw. 6-stündlich gespeichert, 32 Tage). Gibt es noch keine Historie, wird **hochgerechnet**. Die UI kennzeichnet das mit „≈ … (hochgerechnet)“.

### Install-Befehl

Der Befehl wird aus den Manifest-Dateien im Repo-Root abgeleitet, in dieser Reihenfolge:

```
package.json → pyproject.toml / setup.py → Cargo.toml → go.mod → Dockerfile
```

Dabei gelten folgende Regeln:

- **Das Manifest muss zur Hauptsprache passen.** Eine `pyproject.toml` in einem C++-Repo wird zum Beispiel ignoriert.
- **Der Paketname wird gegen die Registry geprüft.** Zeigt das Paket nicht zurück auf dieses Repo, wird es *nicht* empfohlen. Stattdessen erscheint die Installation direkt aus dem Repository, etwa `pip install git+https://github.com/…`. Das schützt vor gleichnamigen fremden Paketen.
- **Namen aus Manifesten sind nicht vertrauenswürdig.** Sie müssen strengen Whitelist-Regexen genügen, damit kein Shell-Code in den kopierbaren Befehl gelangt.
- **Ist nichts ableitbar, wird der Block ausgeblendet.**

### Vertrauens-Ampel

Die Ampel bewertet vier Signale:

- **Lizenz:** Gibt es eine Lizenz, und ist es eine Standard-Lizenz?
- **Repo-Alter:** Ist das Repo älter als 180 Tage?
- **Aktivität:** Gab es einen Push in den letzten 30 bzw. 180 Tagen?
- **Forks/Stars:** Hat ein Repo mindestens 500 Stars, aber weniger als 1 % Forks, gilt das als **„Popularität ungewöhnlich“**. Das schaltet die Ampel immer auf Rot und zeigt einen Warnhinweis.

## Sicherheit

- Es wird nie Code ausgeführt oder installiert. Befehle werden nur zum Kopieren angezeigt, mit dem Hinweis „Prüfe Repos vor der Installation.“
- API-Keys (`GITHUB_TOKEN`, `ANTHROPIC_API_KEY`) werden nur serverseitig im Cron-Job verwendet. Das Frontend sieht keine Keys.
- `/api/cron/refresh` verlangt `Authorization: Bearer $CRON_SECRET`. Ohne gesetztes Secret ist der Endpunkt gesperrt.
- Externe Links erlauben nur `http(s)`. README-Inhalte gehen als Daten an das LLM, nicht als Anweisungen. Antworten für nicht angefragte Repos werden verworfen.

## Deployment auf Vercel

1. Das Repository in Vercel importieren (Framework: Next.js).
2. Unter **Storage → Blob** einen Store anlegen und mit dem Projekt verbinden. Dadurch wird `BLOB_READ_WRITE_TOKEN` gesetzt. Ist der Store *public*, zusätzlich `BLOB_ACCESS=public` setzen.
3. Environment Variables setzen (siehe `.env.example`):
   - `GITHUB_TOKEN`: ein Fine-grained Token ohne zusätzliche Rechte genügt, da nur öffentliche Daten gelesen werden.
   - `CRON_SECRET`: eine lange Zufallszeichenkette.
   - `ANTHROPIC_API_KEY` (optional).
4. Deployen. Aktualisiert wird auf zwei Wegen:
   - **Vercel Cron** (`vercel.json`, täglich um 04:17 UTC): Vercel **Hobby** erlaubt nur tägliche Cron-Jobs.
   - **GitHub Action** `.github/workflows/refresh.yml` (stündlich): Dafür unter *Settings → Secrets and variables → Actions* das Secret `CRON_SECRET` (gleicher Wert wie in Vercel) und die Variable `UNIVERSE_URL` (Produktions-URL) anlegen. Ohne diese beiden überspringt sich der Job.
   - Auf dem Pro-Plan kann stattdessen der Vercel-Cron auf `7 * * * *` gestellt werden.
5. Den ersten Snapshot sofort erzeugen, statt auf den Cron zu warten:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<deine-domain>/api/cron/refresh
   ```

   Bis dahin zeigt die Seite `fallback.json` mit dem Hinweis „Offline-Daten“.

### Kosten der LLM-Anreicherung

Jedes Repo wird **einmal** angereichert. Danach liegt das Ergebnis dauerhaft in `enriched.json`. Pro Lauf kommen höchstens 40 neue Repos dazu.

- **Standardmodell:** `claude-opus-5-5` mit `effort: "low"`. Das kostet beim ersten Lauf (rund 300 Repos) grob 1–2 $, danach nur noch Cent-Beträge pro Stunde.
- **Günstiger:** `ANTHROPIC_MODEL=claude-haiku-5-5` setzen.
- **Ablehnungen:** Für Opus/Sonnet ist der serverseitige Refusal-Fallback (`fallbacks: "default"`) aktiv. Lehnt ein Modell trotzdem ab, kommt der Keyword-Fallback zum Einsatz.

## Lokale Entwicklung

```bash
npm install
```

```bash
npm run dev
```

Ohne Snapshot zeigt die Seite `data/fallback.json`.

```bash
npm test
```

Führt 38 Unit-Tests aus (Pipeline, Wachstum, Install, Ampel, LLM-Parsing, Cron-Auth).

```bash
npm run lint && npm run typecheck
```

```bash
npm run refresh
```

Führt den Pipeline-Lauf einmal lokal aus und braucht dafür `GITHUB_TOKEN` in `.env.local`. Das Ergebnis landet in `./.data`.

```bash
npm run build:fallback
```

Baut `data/fallback.json` neu, auf Basis von `data/fallback-seed.json`.

## Projektstruktur

```
src/app/page.tsx                  Landingpage (statisch, aus dem Snapshot, 5 min revalidiert)
src/app/explore/page.tsx          Explorer (liest Snapshot, Zustand aus URL)
src/app/api/universe/route.ts     GET /api/universe?period=…
src/app/api/cron/refresh/route.ts Stündlicher Refresh (CRON_SECRET-geschützt)
src/components/                   UniverseApp, SpaceCanvas (Canvas + d3-zoom), RepoList, DetailPanel, Legend
src/components/space/             SpaceBackdrop (WebGL-Weltall)
src/components/landing/           Bausteine der Landingpage
src/lib/sprites.ts                Prozedurale Planeten- und Nebel-Sprites
src/lib/server/                   pipeline, github (GraphQL), enrich (Claude), registry, store (Blob/Datei), universe
src/lib/                          types, categories, growth, install, trust, select, layout, format
data/fallback.json                Statischer Fallback-Snapshot
tests/unit/                       Vitest-Tests
```
