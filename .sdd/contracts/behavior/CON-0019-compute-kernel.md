---
id: CON-0019
project: ""                # PRJ-XXXX
title: "Compute kernel for the GPT-2 engine"
type: behavior
format: markdown
spec: SPEC-0008
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/compute-kernel-rules.md"
tests: ["TST-0020", "TST-0021"]
---

# Contract: Compute kernel for the GPT-2 engine

> **Spec:** SPEC-0008 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt fest, wie die GPT-2-Engine affine Schichten und die Vokabular-Projektion über einen
austauschbaren Rechenkern rechnet (`MatrixKernel`): den JS-Kern als Referenz und den WASM-Kern mit
SIMD, die Gewichte im WASM-Speicher, die Auswahl mit Rückfall und das eingecheckte Modul.

## Garantien

Die Regeln K-01 bis K-10 im Artifact (`.sdd/contracts/behavior/compute-kernel-rules.md`) sind
verbindlich.

## Invarianten

- **CK-01 Referenz ist Wahrheit:** Mit jedem Kern gelten die Referenzvergleiche aus CON-0014 und
  CON-0016 unverändert.
- **CK-02 Ein Interface:** `Gpt2Model` kennt nur `MatrixKernel`; welcher Kern rechnet, entscheidet
  allein `selectKernel`.
- **CK-03 Keine stille Langsamkeit im Kern:** Fremde Gewichte werden nicht heimlich kopiert,
  sondern abgelehnt (K-05).
- **CK-04 Bestehende Contracts:** CON-0014 (v0.2.0, `ready` mit `kernel`) und CON-0016 bestehen.

## Validierung

- Tests: TST-0020 (`tests/unit/compute-kernel.test.ts`), TST-0021 (`tests/unit/gpt2-kernel.test.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.1.0 | Erstfassung |
