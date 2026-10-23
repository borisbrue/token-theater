---
id: CON-0020
project: ""                # PRJ-XXXX
title: "Presentation mode and explanations UI"
type: behavior
format: gherkin
spec: SPEC-0009
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/presentation-ui.feature"
tests: ["TST-0022"]
---

# Contract: Presentation mode and explanations UI

> **Spec:** SPEC-0009 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt fest, wie der Präsentationsmodus ein- und ausgeschaltet wird und was die Bühne zeigt, wie
Clicker-Tasten wirken, welche ausführlichen Erklärtexte („Mehr dazu“) jede Station hat, wann ein
Hinweis auf fehlende Interna erscheint und dass der Tokenstrom Leerraum sichtbar macht.

## Garantien

Die Szenarien in `.sdd/contracts/behavior/presentation-ui.feature` sind verbindlich.

## Invarianten

- **PR-01 Bühne ohne Formular:** Im Präsentationsmodus werden Formular, „Erzeugter Text“,
  Ansichtswechsel und „Details“ nicht gerendert.
- **PR-02 Zustand bleibt:** Ein Moduswechsel ändert weder Trace noch Cursor.
- **PR-03 Tastaturregeln:** Keine Kürzel in Eingabefeldern und mit Alt/Strg/Meta (CON-0006 UI-04).
- **PR-04 Texte und Farben:** Texte aus `src/app/texts.ts`, Farben aus dem Theme (CON-0007).
- **PR-05 Bestehende Contracts:** CON-0003, CON-0006, CON-0009, CON-0011, CON-0015, CON-0018
  bestehen unverändert, CON-0013 in v0.2.0.

## Validierung

- Tests: TST-0022 (`tests/e2e/presentation.spec.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung |
