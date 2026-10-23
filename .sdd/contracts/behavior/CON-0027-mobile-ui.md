---
id: CON-0027
project: ""                # PRJ-XXXX
title: "Mobile layout and touch UI"
type: behavior
format: gherkin
spec: SPEC-0013
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/mobile-ui.feature"
tests: ["TST-0032"]
---

# Contract: Mobile layout and touch UI

> **Spec:** SPEC-0013 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt fest, wie die App auf Smartphones (360–430 px breit, Touch) aussieht und bedient wird:
keine waagerecht überlaufende Seite, einspaltige Steuerung, fixierte Transportknöpfe,
Touch-Ziele ab 44 px, Wischen über die Station, Tippen statt Hover, Begriffe als Blatt und eine
Bühne, die im Hoch- und Querformat passt.

## Garantien

Die Szenarien in `.sdd/contracts/behavior/mobile-ui.feature` sind verbindlich.

## Invarianten

- **MO-01 Desktop unverändert:** Alle Regeln gelten nur bei `max-width: 640px`,
  `max-height: 500px` (Bühne) oder `pointer: coarse`; alle bestehenden Tests bleiben grün.
- **MO-02 Alles per Knopf:** Wischen und Tippen ergänzen die Knöpfe, ersetzen sie nicht.
- **MO-03 Theme:** Farben nur aus `src/app/theme` (CON-0007), Texte aus `src/app/texts.ts`.

## Validierung

- Tests: TST-0032 (`tests/e2e/mobile.spec.ts`)

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Erstfassung (SPEC-0013) |
