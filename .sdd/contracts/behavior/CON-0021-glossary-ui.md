---
id: CON-0021
project: ""                # PRJ-XXXX
title: "Layer map and glossary UI"
type: behavior
format: gherkin
spec: SPEC-0010
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/glossary-ui.feature"
tests: ["TST-0023"]
---

# Contract: Layer map and glossary UI

> **Spec:** SPEC-0010 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt fest, wie die Layer-Karte die Stationen eines Schritts gruppiert und die aktuelle markiert,
welche Zeile den Teil im Layer nennt, welche Begriffe jede Station listet, welche Wörter in den
Erklärtexten als Begriff markiert sind, wie sich eine Erklärung öffnen und schließen lässt und
was die Ansicht „Glossar“ zeigt.

## Garantien

Die Szenarien in `.sdd/contracts/behavior/glossary-ui.feature` sind verbindlich. Die Texte des
Glossars stehen wörtlich in SPEC-0010 §3.4 und (seit v0.2.0) SPEC-0011 §3.7.

## Invarianten

- **GL-01 Text bleibt:** Ohne Markierungen ist jeder Erklärsatz und jeder Text „Mehr dazu“ Wort
  für Wort der aus SPEC-0009; eine geschlossene Erklärung ist nicht im DOM (CON-0020 bleibt
  erfüllt).
- **GL-02 Vollständig:** 37 Begriffe (33 aus SPEC-0010, 4 aus SPEC-0011); jede Markierung verweist auf einen davon; jeder steht in
  mindestens einer Liste „Begriffe“.
- **GL-03 Eine Erklärung:** Höchstens eine Erklärung ist offen; Fokusverlust schließt sie.
- **GL-04 Esc zuerst lokal:** `Esc` bei offener Erklärung schließt nur sie, auch auf der Bühne.
- **GL-05 Karte aus dem Trace:** Die Layer-Karte entsteht aus den Stationen des Schritts, nicht
  aus der Architektur; ohne Layer-Stationen gibt es sie nicht.
- **GL-06 Schichtung und Theme:** Texte aus `src/app/texts.ts`, Farben aus dem Theme (CON-0007),
  `src/views` ohne `src/app`/`src/engine` (CON-0004); die Bühne passt bei 1280 × 720 (CON-0020).

## Validierung

- Tests: TST-0023 (`tests/e2e/glossary.spec.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung |
| 2026-10-23 | 0.2.0 | SPEC-0011: vier MoE-Begriffe, 37 statt 33 |
