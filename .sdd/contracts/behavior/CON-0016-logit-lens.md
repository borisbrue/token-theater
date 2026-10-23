---
id: CON-0016
project: ""                # PRJ-XXXX
title: "Logit lens in trace and engines"
type: behavior
format: markdown
spec: SPEC-0007
version: 0.2.1
status: approved
artifact: ".sdd/contracts/behavior/logit-lens-rules.md"
tests: ["TST-0017"]
---

# Contract: Logit lens in trace and engines

> **Spec:** SPEC-0007 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt fest, wie GPT-2- und Mock-Engine die Logit-Lens rechnen (gemeinsame Auswahl in
`src/engine/lens.ts`), wie sie im Trace steht (`residual.lens`, CON-0001 v0.4.0 INV-17) und dass
sie mit der Referenz aus `transformers` übereinstimmt.

## Garantien

Die Regeln L-01 bis L-07 im Artifact (`.sdd/contracts/behavior/logit-lens-rules.md`) sind
verbindlich, ebenso die Referenzwerte in `tests/fixtures/gpt2/tiny-gpt2.lens.json`.

## Invarianten

- **LL-01 Referenz ist Wahrheit:** wie CON-0014 GE-01.
- **LL-02 Gültige Traces:** Jeder Lauf erfüllt CON-0001 (Schema, INV-01 bis INV-17) für jedes
  erlaubte `lensTopN`.
- **LL-03 Eine Auswahlregel:** Softmax, Top-N und Gleichstand stehen nur in `src/engine/lens.ts`.
- **LL-04 Bestehende Contracts:** CON-0002 und CON-0014 bestehen unverändert.

## Validierung

- Tests: TST-0017 (`tests/unit/logit-lens.test.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung |
| 2026-10-22 | 0.2.1 | `prob` > 1 ist ein Schemafehler (`$defs/Candidate`), nicht INV-17; Mock-Lens mit der `<eos>`-Regel |
| 2026-10-22 | 0.2.0 | Review: `coverage` erklärt, Länge `min(lensTopN, vocabSize)`, Gleichstand der logits-Stationen, `length`-Grenze, `decode`-Signatur, INV-17-Bedingung für `vocabSize` |
