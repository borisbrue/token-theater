---
id: CON-0028
project: ""                # PRJ-XXXX
title: "Swipe rules"
type: behavior
format: markdown
spec: SPEC-0013
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/swipe-rules.md"
tests: ["TST-0031"]
---

# Contract: Swipe rules

> **Spec:** SPEC-0013 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt fest, wann eine Touch-Geste über der Station ein Wisch ist und welches Playback-Kommando
sie auslöst (`swipeCommand`), und welche Startziele keinen Wisch auslösen (`swipeIgnored`).

## Garantien

Die Regeln SW-01 bis SW-06 in `.sdd/contracts/behavior/swipe-rules.md` sind verbindlich.

## Validierung

- Tests: TST-0031 (`tests/unit/swipe.test.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Erstfassung (SPEC-0013) |
