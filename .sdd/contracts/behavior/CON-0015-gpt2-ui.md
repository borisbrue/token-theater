---
id: CON-0015
project: ""                # PRJ-XXXX
title: "GPT-2 engine UI"
type: behavior
format: gherkin
spec: SPEC-0006
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/gpt2-ui.feature"
tests: ["TST-0016"]
---

# Contract: GPT-2 engine UI

> **Spec:** SPEC-0006 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt die Bedienung der GPT-2-Engine fest: Wahl im Formular, Modelle aus dem Manifest, Laden mit
Fortschritt, Cache und Abbrechen, Fehlermeldungen und den Lauf selbst.

## Garantien

Die Szenarien im Artifact (`.sdd/contracts/behavior/gpt2-ui.feature`) sind ausführbare
Spezifikation. Jedes Szenario ist ein Playwright-Test (Chromium), Testname = Szenariotitel
wörtlich; ein Abgleichtest prüft die Titel gegen die Feature-Datei.

## Invarianten

- **GU-01 Rollen statt Selektoren:** wie CON-0006 UI-01; Netzwerk nur über `page.route`.
- **GU-02 Bestehende Contracts:** CON-0003, CON-0006, CON-0009, CON-0011 und CON-0013 bestehen
  unverändert; „Mock“ bleibt Default.
- **GU-03 Kein fremder Origin:** Request-Fixture aus `tests/e2e/helpers.ts`.
- **GU-04 Texte:** aus `src/app/texts.ts`.

## Bedienelemente

| Element | Rolle / Erkennung | Name |
|---|---|---|
| Engine | `group` "Engine" mit `radio` "Mock", "Server", "GPT-2 (Browser)" | – |
| Modell | `combobox` "GPT-2-Modell" mit den Manifest-Namen | – |
| Hinweis | Text "Keine GPT-2-Gewichte gefunden. Mit „npm run fetch-model -- distilgpt2“ herunterladen." | – |
| Fortschritt | Text "Lade Gewichte: x von y MB" bzw. "Gewichte aus dem Browser-Cache", danach "Schritt i von n"; `button` "Abbrechen" | – |
| Fehler | `alert` "Erzeugen fehlgeschlagen: <Meldung>" | – |

## Validierung

- Tests: TST-0016 (`tests/e2e/gpt2.spec.ts`)
