---
id: CON-0008
project: ""                # PRJ-XXXX
title: "GPT-2 BPE tokenizer"
type: behavior
format: markdown
spec: SPEC-0003
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/gpt2-bpe-tokenizer-rules.md"
tests: ["TST-0008", "TST-0009"]
---

# Contract: GPT-2 BPE tokenizer

> **Spec:** SPEC-0003 · **Typ:** Verhalten (Markdown) · **Status:** approved

## Zweck

Legt den GPT-2-Tokenizer fest: Byte-Tabelle, Vorzerlegung, Merges, IDs wie tiktoken,
verlustfreier Round-Trip, `explain` mit den Merge-Stufen, Laden und Prüfen der Assets mit
klaren Fehlern und die Anbindung an den Generator (BPE-Details im Trace). Das Trace-Format des
Feldes `bpe` und INV-16 stehen in CON-0001 v0.3.0.

## Garantien

Die Regeln B-01 bis B-13 im Artifact (`.sdd/contracts/behavior/gpt2-bpe-tokenizer-rules.md`)
sind verbindlich. Referenzdaten: `.sdd/contracts/behavior/gpt2-bpe-reference.json`
(tiktoken 0.14.0, Kodierung `gpt2`, 23 Texte; Merge-Stufen für zwei Texte).

## Invarianten

- **TK-01 Referenz ist Wahrheit:** Weicht `encode` für einen Referenztext ab, ist der Tokenizer
  falsch, nicht die Referenz. Die Referenzdatei wird nur zusammen mit dieser Contract-Version
  geändert.
- **TK-02 Keine stillen Fehler:** Ungültige Assets führen zu `TokenizerLoadError`, nie zu einem
  Tokenizer mit falschen IDs.
- **TK-03 Determinismus:** `encode`/`explain` sind reine Funktionen des Textes (Cache ohne
  Wirkung, B-07); CON-0004 R-04 gilt für `src/engine/tokenizer/**`.
- **TK-04 Schichten:** `src/engine/tokenizer/**` importiert kein React und aus `src/trace` nur
  Typen (CON-0004 R-03).

## Validierung

- Tests: TST-0008 (B-01 bis B-12), TST-0009 (B-13 und INV-16 aus CON-0001)
