---
id: CON-0026
project: ""                # PRJ-XXXX
title: "Comparison metrics, probe import and probe tools"
type: behavior
format: markdown
spec: SPEC-0012
version: 0.1.1
status: approved
artifact: ".sdd/contracts/behavior/compare-probe-rules.md"
tests: ["TST-0027", "TST-0028", "TST-0029"]
---

# Contract: Comparison metrics, probe import and probe tools

> **Spec:** SPEC-0012 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt die reinen Kennzahlen des Vergleichs fest (`@/views/compare/diff`, Regeln CD-xx, geprüft in
TST-0029), die Import-Ketten für Sonde und Bericht (`@/probe`, Regeln PF-xx, TST-0027) und die
Python-Werkzeuge `probe.py` und `verify_weights.py` samt Beispielsonden und Bericht-Fixture
(Regeln PT-xx, TST-0028). Das Format selbst regelt CON-0024.

## Garantien

Die Regeln in `.sdd/contracts/behavior/compare-probe-rules.md` sind verbindlich.

## Validierung

- TST-0027, TST-0028, TST-0029; Verhalten der Python-Werkzeuge zusätzlich in
  `scripts/moe-export/tests/` (`uv run pytest`, außerhalb des GREEN-Gates).

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Erstfassung (SPEC-0012) |
| 2026-10-23 | 0.1.1 | PT-05: Fixture mit Seed 2 und mindestens einem Umschwung; CD-03 wie SPEC-0012 §3.2 bei fehlender Architektur |
