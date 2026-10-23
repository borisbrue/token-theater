---
id: CON-0017
project: ""                # PRJ-XXXX
title: "Station view computations"
type: behavior
format: markdown
spec: SPEC-0007
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/station-view-rules.md"
tests: ["TST-0018"]
---

# Contract: Station view computations

> **Spec:** SPEC-0007 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt die reinen Rechnungen der Ansichten fest: Zeilen und Statistik von Tensoren, Farbskalen,
die zusammengesetzte Attention-Matrix mit KV-Cache-Zeilen und kausaler Maske, die am stärksten
beachteten Positionen und den Verlauf des Residual Stream.

## Garantien

Die Regeln V-01 bis V-08 im Artifact (`.sdd/contracts/behavior/station-view-rules.md`) sind
verbindlich.

## Invarianten

- **SV-01 Rein:** Die Module unter `src/views/tensor/*.ts` haben keine Seiteneffekte, verändern
  ihre Eingaben nicht und importieren weder `src/app` noch `src/engine` (CON-0004).
- **SV-02 Werte des Traces:** Die Ansichten zeigen, was diese Funktionen aus dem Trace
  berechnen; sie runden erst bei der Anzeige.
- **SV-03 Farben als Daten:** Farbskalen kommen als `ScaleStop[]` herein; die Module enthalten
  keine Farbwerte (CON-0007 T-03).

## Validierung

- Tests: TST-0018 (`tests/unit/station-views.test.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung |
| 2026-10-22 | 0.2.0 | Review: `tensorRow` als Kopie, Formregel `e = b − a`, erstes Vorkommen gilt, Randfälle von `sampleScale`, `n`-Grenzen, aktueller Eintrag über `stationIndex` |
