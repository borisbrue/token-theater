---
id: CON-0022
project: ""                # PRJ-XXXX
title: "MoE routing UI"
type: behavior
format: gherkin
spec: SPEC-0011
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/moe-ui.feature"
tests: ["TST-0026"]
---

# Contract: MoE routing UI

> **Spec:** SPEC-0011 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt fest, wie die App MoE-Traces zeigt: Engine „Mock-MoE“, Stationen `moe` mit Routing-Tabelle,
gewählten Experten und dem Weg eines Tokens durch alle Layer, Layer-Karte mit Kurztext `X` und
Verdichtung ab mehr als 8 Layern, Texte und Begriffe der Station, Import exportierter MoE-Traces.

## Garantien

Die Szenarien in `.sdd/contracts/behavior/moe-ui.feature` sind verbindlich. Texte stehen wörtlich
in SPEC-0011 §3.6 und §3.7.

## Invarianten

- **MU-01 Routing aus dem Trace:** Jede Zahl der Ansicht stammt aus der Station: Zellfarbe und
  „Router %“ aus `softmax(routerLogits[i])`, „gewählt“ und „Gate %“ aus `experts[i]`/`gates[i]`
  (ganze Prozent, kaufmännisch gerundet). Die Ansicht rechnet kein Routing nach.
- **MU-02 Eine Auswahl:** Die gewählte Position ist die gemeinsame Auswahl des Players
  (SPEC-0007 §3.8); Routing-Zeile, „Gewählte Experten“ und „Alle Layer“ zeigen dieselbe.
- **MU-03 Bestand bleibt:** Traces ohne `moe` sehen aus wie vorher; die Karte bis 8 Layer ist die
  aus CON-0021, der Hinweis ohne Interna erscheint für Traces ohne `attention`, ohne `residual` oder
  ohne `mlp` und `moe` (CON-0020 bleibt erfüllt).
- **MU-04 Schichtung und Theme:** Texte aus `src/app/texts.ts`, Farben aus dem Theme (CON-0007),
  `src/views` ohne `src/app`/`src/engine` (CON-0004); die Bühne passt bei 1280 × 720 auch mit
  24 Layern.

## Validierung

- Tests: TST-0026 (`tests/e2e/moe.spec.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Erstfassung |
