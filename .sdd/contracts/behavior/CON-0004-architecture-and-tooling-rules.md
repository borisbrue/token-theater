---
id: CON-0004
project: ""                # PRJ-XXXX
title: "Architecture and tooling rules"
type: behavior
format: markdown
spec: SPEC-0001
version: 0.2.0
status: approved
artifact: ".sdd/contracts/behavior/architecture-and-tooling-rules.md"
tests: ["TST-0004"]
---

# Contract: Architecture and tooling rules

> **Spec:** SPEC-0001 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Hält die Architektur- und Werkzeugregeln aus SPEC-0001 (FR-01, FR-09, FR-11, FR-12,
NFR Wartbarkeit/Determinismus) und AGENTS.md (Taste Invariants) als prüfbare
Regeln fest, damit Agenten sie in späteren Specs nicht schleichend aufweichen.

## Garantien

Jede Regel R-01 bis R-08 im Artifact
(`.sdd/contracts/behavior/architecture-and-tooling-rules.md`) ist durch einen
automatisierten Test abgedeckt (TST-0004), mit dem dort genannten Mechanismus.
Für die mit (F) markierten ESLint-Regeln gibt es Fixture-Paare (Verstoß und
Gegenbeispiel), die auf `ruleId` und `severity` geprüft werden.

## Invarianten

- **INV-01:** Fixtures liegen unter `tests/fixtures/lint/` und sind vom normalen
  `npm run lint` und von Prettier ausgeschlossen.
- **INV-02:** Ein Fixture-Test gilt nur als bestanden, wenn die erwartete `ruleId`
  mit `severity 2` gemeldet wird. Ein Parse-Fehler oder eine ignorierte Datei
  zählt als Fehlschlag.
- **INV-03 (Prozessregel, nicht automatisiert):** Die Regeln gelten für alle
  künftigen Specs. Änderungen an R-01 bis R-08 brauchen einen neuen
  Contract-Stand mit Versionssprung.
