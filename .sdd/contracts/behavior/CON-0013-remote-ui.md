---
id: CON-0013
project: ""                # PRJ-XXXX
title: "Remote engine UI"
type: behavior
format: gherkin
spec: SPEC-0005
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/remote-ui.feature"
tests: ["TST-0014"]
---

# Contract: Remote engine UI

> **Spec:** SPEC-0005 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt die Bedienung des Server-Modus fest: Engine-Wahl, Profile, Server-Felder, Modelle laden,
Dialekt, Läufe mit Fortschritt und Abbrechen, Fehlermeldungen und den Umgang mit dem API-Key.

## Garantien

Die Szenarien im Artifact (`.sdd/contracts/behavior/remote-ui.feature`) sind ausführbare
Spezifikation. Jedes Szenario ist ein Playwright-Test (Chromium), Testname = Szenariotitel
wörtlich; ein Abgleichtest prüft die Titel gegen die Feature-Datei.

## Invarianten

- **RU-01 Rollen statt Selektoren:** wie CON-0006 UI-01; Ausnahme `evaluate` für localStorage und
  sessionStorage im Szenario „Der API-Key wird nicht gespeichert“. Netzwerk nur über `page.route`.
- **RU-02 Bestehende Contracts:** CON-0003, CON-0006, CON-0009 und CON-0011 bestehen unverändert;
  „Mock“ ist Default.
- **RU-03 Kein fremder Origin:** Request-Fixture aus `tests/e2e/helpers.ts`; der Fake-Server liegt
  auf dem eigenen Origin.
- **RU-04 Texte:** aus `src/app/texts.ts`; Fehlermeldungen der Engine wörtlich (CON-0012 RE-09).

## Bedienelemente

| Element | Rolle / Erkennung | Name |
|---|---|---|
| Engine | `group` "Engine" (`fieldset`/`legend`) vor "Sampling" mit `radio` "Mock" (Default) und "Server" | – |
| Profil | `combobox` "Profil" mit Option "Eigene Angaben" und den Presets in deren Reihenfolge | – |
| Basis-URL | `textbox` "Basis-URL" | – |
| API-Key | Feld `type="password"` mit Label "API-Key" | – |
| Modell | `combobox`/`textbox` "Modell" (Eingabe mit Vorschlagsliste) | – |
| Dialekt | `combobox` "Dialekt": "Automatisch", "Klassisch (vLLM)", "Logprobs-Liste (MLX)" mit den Optionswerten `auto`, `legacy`, `content` | – |
| Modelle laden | `button`; Status als Text in "Engine": "n Modelle gefunden" bzw. Fehlermeldung | – |
| Stationsknöpfe | wie CON-0006; ihr `aria-label` ist der Stationsname | – |
| Fortschritt | Text "Schritt i von n" und `button` "Abbrechen", nur während eines Server-Laufs | – |
| Lauf-Fehler | `alert` "Der Lauf wurde abgebrochen: <Meldung>" (Trace mit `error`) bzw. "Erzeugen fehlgeschlagen: <Meldung>" (Fehler vor dem ersten Schritt, CON-0003) | – |

## Validierung

- Tests: TST-0014 (`tests/e2e/remote.spec.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung (SPEC-0005) |
| 2026-10-22 | 0.2.0 | SPEC-0009: Der Tokenstrom zeigt Leerraum sichtbar; der Server-Prompt erscheint als „Die␣Katze␣sitzt␣auf␣dem“ |
