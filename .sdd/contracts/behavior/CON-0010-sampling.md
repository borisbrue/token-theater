---
id: CON-0010
project: ""                # PRJ-XXXX
title: "Client-side sampling"
type: behavior
format: markdown
spec: SPEC-0004
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/sampling-rules.md"
tests: ["TST-0011"]
---

# Contract: Client-side sampling

> **Spec:** SPEC-0004 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt die Sampling-Mathematik (Temperatur → Top-k → Top-p → Renormierung, Wurf), den
`StochasticSampler`, die Übernahme der Parameter in den Trace und die Schichtregel für
`src/sampling/` fest. Grundlage für Sampler (Engine) und Sampling-Labor (View).

## Garantien

Die Regeln S-01 bis S-11 im Artifact (`.sdd/contracts/behavior/sampling-rules.md`) sind
verbindlich, einschließlich der Referenzvektoren (±1e-6).

## Invarianten

- **SA-01 Reihenfolge:** Temperatur, Top-k, Top-p, Renormierung – immer in dieser Reihenfolge,
  nicht konfigurierbar.
- **SA-02 Rng-Verbrauch:** Greedy zieht nie, `StochasticSampler` genau einmal je Schritt.
- **SA-03 Reinheit:** `src/sampling/` ist frei von Seiteneffekten, Zeit und Zufall; Zufall kommt
  nur als Zahl `r` in `drawIndex`.
- **SA-04 Trace-Format:** Ergebnisverteilungen erfüllen CON-0001 INV-10, Sample-Stationen INV-11;
  das Trace-Format selbst ändert sich nicht.

## Validierung

- Tests: TST-0011 (`tests/unit/sampling.test.ts`)
