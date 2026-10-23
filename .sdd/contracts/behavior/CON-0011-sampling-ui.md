---
id: CON-0011
project: ""                # PRJ-XXXX
title: "Sampling UI"
type: behavior
format: gherkin
spec: SPEC-0004
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/sampling-ui.feature"
tests: ["TST-0012"]
---

# Contract: Sampling UI

> **Spec:** SPEC-0004 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt die sichtbare Seite des Samplings fest: Sampling-Steuerung im Formular, Logits-Ansicht mit
Balken, Sampling-Labor und den sichtbaren Zufallswurf der sample-Station.

## Garantien

Die Szenarien im Artifact (`.sdd/contracts/behavior/sampling-ui.feature`) sind ausführbare
Spezifikation. Jedes Szenario ist ein Playwright-Test (Chromium), Testname = Szenariotitel
wörtlich; ein Abgleichtest prüft die Titel gegen die Feature-Datei.

## Invarianten

- **SU-01 Rollen statt Selektoren:** wie CON-0006 UI-01; keine Ausnahmen nötig.
- **SU-02 Bestehende Contracts:** CON-0003, CON-0006 (v0.2.0) und CON-0009 bestehen unverändert.
- **SU-03 Kein fremder Origin:** Request-Fixture aus `tests/e2e/helpers.ts`.
- **SU-04 Texte und Zahlen:** Texte aus `src/app/texts.ts`; Zahlen mit Dezimalkomma
  (Prozent eine Nachkommastelle, Temperatur eine, Top-p zwei, Zufallszahl drei, Logit zwei).
- **SU-05 Dekoration:** Balken und Zahlenstrahl sind `aria-hidden`; jede Information steht auch
  als Text.

## Bedienelemente

| Element | Rolle / Erkennung | Name |
|---|---|---|
| Sampling | `group` "Sampling" (`fieldset`/`legend`) vor "Erzeugen" | – |
| Strategie | `radio` | "Greedy" (Default), "Zufall" |
| Temperatur | `slider` 0.1–2, Schritt 0.1; Wert daneben als Text ("0,7") | "Temperatur" |
| Top-k | `spinbutton` 0–100 | "Top-k" |
| Top-p | `slider` 0.05–1, Schritt 0.05; Wert daneben als Text | "Top-p" |
| Seed | `spinbutton` | "Seed" |
| Kandidaten | `list` "Kandidaten" in "Station" (logits, sample), ≤ 10 `listitem`: Anzeigetext, Balken, "41,2 %", Logit "3,12" bzw. "–"; in sample der gewählte mit `aria-current="true"` | – |
| Rest | Text "+ n weitere Tokens mit zusammen x %" | – |
| Abdeckung | "Nur die n gelieferten Kandidaten, sie decken x % ab." bzw. "Abdeckung der Verteilung unbekannt." | – |
| Labor | `region` "Sampling-Labor" mit `slider` "Labor-Temperatur", `spinbutton` "Labor-Top-k", `slider` "Labor-Top-p", `button` "Zurücksetzen", `list` "Labor-Verteilung" (Einträge "<Text> 41,2 % → 63,0 %" bzw. "… → entfernt") und Hinweis "Das Labor rechnet nur diese Verteilung um, der Trace bleibt unverändert." | – |
| Parameter | "Strategie: Greedy" bzw. "Temperatur 1,0 · Top-k aus · Top-p 1,00 · Seed 7" | – |
| Wurf | "Zufallszahl 0,734 fällt auf „katze“" bzw. "Greedy: kein Zufall, gewählt wird das wahrscheinlichste Token „katze“." | – |

## Validierung

- Tests: TST-0012 (`tests/e2e/sampling.spec.ts`)
