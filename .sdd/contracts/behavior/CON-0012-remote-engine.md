---
id: CON-0012
project: ""                # PRJ-XXXX
title: "Remote engine for OpenAI-compatible servers"
type: behavior
format: markdown
spec: SPEC-0005
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/remote-engine-rules.md"
tests: ["TST-0013"]
---

# Contract: Remote engine for OpenAI-compatible servers

> **Spec:** SPEC-0005 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt fest, wie die `RemoteEngine` einen OpenAI-kompatiblen Completions-Server in den Dialekten
`legacy` (vLLM/mittwald) und `content` (OptiQ/MLX) befragt, Antworten in Tokens, IDs und
Verteilungen übersetzt, Fehler meldet, abbricht und über die Factory entsteht.

## Garantien

Die Regeln RE-01 bis RE-13 im Artifact (`.sdd/contracts/behavior/remote-engine-rules.md`) sind
verbindlich, ebenso die aufgezeichneten Antworten unter `tests/fixtures/remote/`.

## Invarianten

- **RM-01 Nur die Verteilung:** Je Schritt genau eine Anfrage mit `max_tokens: 1`; das vom Server
  gezogene Token wird nie übernommen, gezogen wird im Client (SPEC-0004).
- **RM-02 Gültige Traces:** Jeder Lauf ergibt einen Trace, der CON-0001 (Schema, INV-01 bis
  INV-16) erfüllt; ungültige Antworten werden zu Fehlern, nie still in den Trace übernommen.
- **RM-03 Kein Geheimnis im Trace:** Der API-Key erscheint weder im Trace noch in Fehlermeldungen.
- **RM-04 Schichten:** Nur `src/app/engine-factory.ts` importiert `src/engine/remote`; dort gelten
  CON-0004 R-02 bis R-04; `fetch` kommt über die Abhängigkeit.

## Validierung

- Tests: TST-0013 (`tests/unit/remote-engine.test.ts`)
