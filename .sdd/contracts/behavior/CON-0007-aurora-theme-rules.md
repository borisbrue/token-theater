---
id: CON-0007
project: ""                # PRJ-XXXX
title: "Aurora theme rules"
type: behavior
format: markdown
spec: SPEC-0002
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/aurora-theme-rules.md"
tests: ["TST-0007"]
---

# Contract: Aurora theme rules

> **Spec:** SPEC-0002 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Macht die Designsprache aus ADR-0001 prüfbar: Tokens, Kontraste, Farbwerte nur im Theme,
gebündelte Schriften, reduzierte Bewegung, nur Dark Mode und sichtbarer Fokus. Das Theme ist
unabhängig vom Playback versionierbar (SPEC-0002 §3.9).

## Garantien

Jede Regel T-01 bis T-08 im Artifact (`.sdd/contracts/behavior/aurora-theme-rules.md`) ist durch
einen automatisierten Test mit dem dort genannten Mechanismus abgedeckt (TST-0007). Dass das
Theme im Browser tatsächlich wirkt, prüft CON-0006 („Aurora-Theme ist aktiv“, „Reduzierte
Bewegung“).

## Invarianten

- **INV-01:** ADR-0001 ist die Quelle der Werte. Ändert sich ein Wert, ändern sich ADR, T-01 und
  `tokens.css`/`tokens.ts` gemeinsam; T-08 prüft die Übereinstimmung von ADR und `COLORS`
  automatisch, der Rest ist Prozessregel.
- **INV-02:** Testnamen beginnen mit der Regel-ID (`"T-02 …"`).
