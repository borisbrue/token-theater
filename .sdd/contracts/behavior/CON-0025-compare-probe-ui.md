---
id: CON-0025
project: ""                # PRJ-XXXX
title: "Comparison and probe report UI"
type: behavior
format: gherkin
spec: SPEC-0012
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/compare-probe-ui.feature"
tests: ["TST-0030"]
---

# Contract: Comparison and probe report UI

> **Spec:** SPEC-0012 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt fest, was die Ansichten „Vergleich“ und „Sonde“ zeigen: zweiter Trace-Import, Hinweise zur
Vergleichbarkeit, Schrittwahl, Tabellen „Ausgabe“ und „Layer“ mit JS-Divergenz, Kosinus und
größtem Abfall, Import und Tabelle eines Sonden-Berichts mit Zusammenfassung, Sortierung und
festem Hinweis, Fehlermeldungen beider Importe.

## Garantien

Die Szenarien in `.sdd/contracts/behavior/compare-probe-ui.feature` sind verbindlich. Die Texte
stehen wörtlich in SPEC-0012 §3.6, die Zahlen kommen aus `@/views/compare/diff` (CON-0026) bzw.
aus dem Bericht.

## Invarianten

- **CU-01 Nur aus den Daten:** Jede Zahl der Ansichten stammt aus den beiden Traces bzw. dem
  Bericht; die Traces bleiben unverändert (Traces sind unveränderlich, AGENTS.md).
- **CU-02 Kein Urteil:** Keine Ansicht nennt ein Modell „sicher“, „unbedenklich“ oder
  „kompromittiert“; „Bias“ steht nur im festen Hinweis der Sonde.
- **CU-03 Schichtung und Theme:** Texte aus `src/app/texts.ts`, Farben nur aus `src/app/theme`,
  `src/views` ohne `src/app`/`src/engine` (CON-0004).

## Validierung

- Tests: TST-0030 (`tests/e2e/compare.spec.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Erstfassung (SPEC-0012) |
