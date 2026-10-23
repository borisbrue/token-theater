---
id: CON-0023
project: ""                # PRJ-XXXX
title: "MoE trace sources: Mock-MoE and Python exporter"
type: behavior
format: markdown
spec: SPEC-0011
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/moe-sources-rules.md"
tests: ["TST-0024", "TST-0025"]
---

# Contract: MoE trace sources

> **Spec:** SPEC-0011 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt fest, wie MoE-Traces entstehen: die Option `moe` der Mock-Engine samt Engine-Art
`mock-moe` (Regeln MS-xx, geprüft in TST-0024) und der Python-Exporter unter
`scripts/moe-export/` mit seinem Fixture (Regeln EX-xx, geprüft in TST-0025). Das Format selbst
regelt CON-0001 v0.5.0.

## Garantien

Die Regeln in `.sdd/contracts/behavior/moe-sources-rules.md` sind verbindlich.

## Validierung

- Tests: TST-0024 (`tests/unit/moe-trace.test.ts`, MS-xx), TST-0025
  (`tests/unit/moe-fixture.test.ts`, EX-xx)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Erstfassung |
