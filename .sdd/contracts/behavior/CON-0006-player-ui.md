---
id: CON-0006
project: ""                # PRJ-XXXX
title: "Player UI"
type: behavior
format: gherkin
spec: SPEC-0002
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/player-ui.feature"
tests: ["TST-0006"]
---

# Contract: Player UI

> **Spec:** SPEC-0002 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt die sichtbare Wiedergabe fest: Transportleiste, Tempo, Zeitleiste, Stationsleiste,
Tokenstrom, Stationsansicht, Statusmeldung, Tastaturkürzel und das aktive Aurora-Theme im
Browser. Der Trace-Inspector aus CON-0003 bleibt unverändert gültig.

## Garantien

Die Szenarien im Artifact (`.sdd/contracts/behavior/player-ui.feature`) sind ausführbare
Spezifikation. Jedes Szenario ist ein Playwright-Test (Chromium), Testname = Szenariotitel
wörtlich; beim Szenariogrundriss `"<Titel> (taste=<taste>)"`. Zeit vergeht nur über
`page.clock` (vor `page.goto` installiert). Ein Abgleichtest prüft Titel gegen die Feature-Datei.

## Invarianten

- **UI-01 Rollen statt Selektoren:** Tests nutzen nur `getByRole`/`getByLabel`/`getByText`
  innerhalb der benannten Regionen und Gruppen; keine CSS-Selektoren, keine Test-IDs. Ausnahme:
  `evaluate`/`getComputedStyle` und `boundingBox` für berechnete Styles und Größen in den
  Szenarien „Aurora-Theme ist aktiv“, „Reduzierte Bewegung“ und „Fokusring und Mindestgröße“.
  Farben werden gegen `COLORS` aus `src/app/theme/tokens.ts` verglichen, nie gegen Literale.
- **UI-02 CON-0003 bleibt gültig:** Alle Szenarien aus CON-0003 bestehen unverändert; die
  Liste „Schritte“ und die Region „Erzeugter Text“ existieren weiter.
- **UI-03 Kein fremder Origin:** wie CON-0003 UI-04, einschließlich Schriften. Jeder Test nutzt
  das Request-Fixture aus `tests/e2e/helpers.ts` (Auto-Fixture `requests`).
- **UI-04 Tastaturkürzel:** wirken auf `document`, außer wenn das Ereignisziel ein `input`,
  `textarea`, `select` oder `contenteditable` ist; die Leertaste wirkt zusätzlich nicht, wenn
  das Ziel ein `button` ist. Wirksame Kürzel rufen `preventDefault()` auf (kein Scrollen).
- **UI-05 Fokus:** Jeder Knopf hat einen sichtbaren Fokusring (`:focus-visible`), alle Knöpfe
  der Region „Wiedergabe“ sind mindestens 44 × 44 px groß (Szenario „Fokusring und Mindestgröße“).
- **UI-06 Statusmeldung:** nach `load` und bei jedem manuellen Cursorwechsel; während der
  Wiedergabe nur beim Wechsel in einen neuen Schritt.

## Bedienelemente

| Element | Rolle / Erkennung | Name |
|---|---|---|
| Wiedergabe | `region` | "Wiedergabe" (nur mit ≥ 1 Schritt) |
| Transportknöpfe | `button` in „Wiedergabe“ | "Zum Anfang", "Schritt zurück", "Station zurück", "Abspielen" bzw. "Pause", "Station vor", "Schritt vor", "Zum Ende" |
| Tempo | `group` "Tempo", darin `button` mit `aria-pressed` | "0.25×", "0.5×", "1×", "2×" |
| Zeitleiste | `group` "Zeitleiste", je Schritt ein `button` | "Schritt n"; aktueller mit `aria-current="step"` |
| Stationsleiste | `group` "Stationen", je Station ein `button` | Kurzlabel sichtbar (TOK, EMB, A0, R, M0, …, LOG, SMP), Name per `aria-label`: `kind`, bei Layer-Stationen " · Layer l", bei residual zusätzlich " · nach Attention" bzw. " · nach MLP"; aktueller mit `aria-current="step"` |
| Tokenstrom | `region` "Tokenstrom" mit einer `list`; je Token ein `listitem`, das neue mit `aria-current="true"`; Platzhalter als `listitem` mit Text "?" und `aria-label` "nächstes Token" |
| Station | `region` "Station": Text "Schritt n · Station i / k", `heading` Ebene 2 mit dem Stationsnamen (wie in der Stationsleiste), Erklärtext, Tensorformen "name [shape]", bei logits/sample eine `list` "Kandidaten" mit bis zu 10 `listitem` (Format CON-0011, seit v0.2.0) |
| Statusmeldung | `status` (`aria-live="polite"`) | "Schritt n · Station i von k · Name" |

Anzeigen zählen Stationen ab 1 ("Station 1 / 12"), Schritte ab 0 ("Schritt 0") – wie die
Schrittliste aus CON-0003.

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.2.0 | SPEC-0004: Kandidatenliste der logits-Station mit 10 statt 3 Einträgen (Szenario „Stationsansicht zeigt Tensorformen und Kandidaten“) |
