---
id: CON-0014
project: ""                # PRJ-XXXX
title: "GPT-2 engine"
type: behavior
format: markdown
spec: SPEC-0006
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/gpt2-engine-rules.md"
tests: ["TST-0015"]
---

# Contract: GPT-2 engine

> **Spec:** SPEC-0006 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt fest, wie die GPT-2-Engine safetensors-Gewichte und die Konfiguration liest, GPT-2 rechnet
(numerisch gleich Hugging Face `transformers`), den KV-Cache nutzt, über einen Worker
kommuniziert und als `InferenceEngine` Traces mit allen sieben Stationsarten erzeugt.

## Garantien

Die Regeln G-01 bis G-09 im Artifact (`.sdd/contracts/behavior/gpt2-engine-rules.md`) sind
verbindlich, ebenso die Referenzwerte in `tests/fixtures/gpt2/tiny-gpt2.golden.json`.

## Invarianten

- **GE-01 Referenz ist Wahrheit:** Weicht die Rechnung von `transformers` ab, ist die Engine
  falsch. Referenzwerte ändern sich nur mit einer neuen Contract-Version.
- **GE-02 Gültige Traces:** Jeder Lauf erfüllt CON-0001 (Schema, INV-01 bis INV-16).
- **GE-03 Kein stiller Fehler:** Ungültige Gewichte führen zu `Gpt2LoadError`, nie zu einem
  rechnenden Modell.
- **GE-04 Schichten:** Nur `src/app/engine-factory.ts` importiert `src/engine/gpt2`; dort gelten
  CON-0004 R-02 bis R-04.

## Validierung

- Tests: TST-0015 (`tests/unit/gpt2-engine.test.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung (SPEC-0006) |
| 2026-10-22 | 0.2.0 | SPEC-0008: `ready` meldet zusätzlich den Rechenkern (`kernel`, CON-0019 K-09) |
