---
id: SPEC-0004
title: "Logits, softmax and sampling view with client-side sampling"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.2.0
priority: high          # low | medium | high | critical
tags: [sampling, logits, ui, engine]
depends_on: ["SPEC-0001", "SPEC-0002", "SPEC-0003"]
contracts: ["CON-0010", "CON-0011"]
tests: ["TST-0011", "TST-0012"]
fr_test_map:
  FR-01: [TST-0011]
  FR-02: [TST-0011]
  FR-03: [TST-0011]
  FR-04: [TST-0011]
  FR-05: [TST-0011, TST-0012]
  FR-06: [TST-0012]
  FR-07: [TST-0012]
  FR-08: [TST-0012]
  FR-09: [TST-0012]
  FR-10: [TST-0012]
  FR-11: [TST-0012]
  FR-12: [TST-0012]
---

# Logits, softmax and sampling view with client-side sampling

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.0
> Grundlage: `.sdd/docs/architecture/vision.md` (Stationen 4 „Logits → Softmax“ und 5 „Sampling“,
> Leitsatz „Sampling erfolgt im Client“), ADR-0001 (Aurora)

## 1. Kontext & Motivation

Am Ende jedes Durchlaufs steht eine Wahrscheinlichkeitsverteilung über das Vokabular, und
daraus wird **ein** Token gezogen. Das ist die Stelle, an der man den Zufall eines Sprachmodells
sehen und verstehen kann: Warum antwortet ein Modell mal so, mal anders? Was bewirkt
„Temperatur“? Bisher kennt Token Theater nur Greedy (immer das wahrscheinlichste Token), und die
Stationen `logits` und `sample` zeigen nur die drei besten Kandidaten als Text.

Laut Vision zieht die App das nächste Token **immer selbst** („Sampling im Client“), auch später
im Remote-Modus. Diese Spec liefert deshalb die Sampling-Mathematik als eigenständiges, reines
Modul, einen Zufalls-Sampler mit Temperatur, Top-k und Top-p und die beiden Ansichten:
Verteilung als Balken mit einem „Sampling-Labor“ zum Ausprobieren und den sichtbaren Zufallswurf.

## 2. Zielsetzung

**Primärziel:** Reproduzierbares Client-Sampling mit Temperatur, Top-k und Top-p sowie
Ansichten, die Verteilung, Umformung und Zufallswurf sichtbar machen.

**Erfolgskriterien (messbar):**
- [ ] Die Umformung (Temperatur → Top-k → Top-p → Renormierung) und der Wurf liefern für die Referenzvektoren aus CON-0010 die festgelegten Werte (±1e-6).
- [ ] Gleicher Prompt, gleicher Seed und gleiche Parameter ergeben denselben Trace; Top-k = 1 ergibt denselben Text wie Greedy.
- [ ] Die Station `logits` zeigt die zehn wahrscheinlichsten Kandidaten als Balken, die Station `sample` den Zufallswert auf einem Zahlenstrahl und das gewählte Token.
- [ ] Das Sampling-Labor formt die Verteilung live um, ohne den Trace zu ändern.
- [ ] Alle Tests aus SPEC-0001 bis SPEC-0003 bleiben grün (CON-0006 mit der in §3.9 beschriebenen Anpassung).

**Nicht-Ziele (explizit):**
- Remote-Adapter (Ollama, llama.cpp) → SPEC-0005; die Mathematik hier kann aber schon mit Verteilungen ohne Logits umgehen (Top-N mit `logit: null`)
- Neu-Erzeugen des Traces beim Verschieben eines Labor-Reglers (das Labor rechnet nur die aktuelle Verteilung um)
- Weitere Strategien (Min-p, Typical, Beam Search, Repetition Penalty)
- Animation des Zufallswurfs, Präsentationsmodus → SPEC-0008

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/sampling/           transform.ts – reine Funktionen über Kandidatenlisten (kein React, keine Engine)
src/engine/samplers/    stochastic.ts (StochasticSampler), greedy.ts unverändert
src/engine/generate.ts  übernimmt sampler.params in trace.sampling.params
src/views/distribution/ LogitsView, SamplingLab, SampleView, format.ts – nur Props
src/views/station/      StationRenderContext bekommt `sampling` (SamplingParams des Traces)
src/app/                Sampling-Steuerung, sampling-choice.ts (createSampler), trace-actions, Renderer
```

`src/sampling/` ist eine neue, reine Schicht: Sie importiert aus `src/` höchstens **Typen** aus
`src/trace/` und nichts sonst (kein React). Engine und Views dürfen sie importieren. So nutzen
der Sampler (Engine) und das Labor (View) **dieselbe** Rechnung, ohne dass Views die Engine
kennen (CON-0004 R-03 bleibt gültig). Die Regel wird per ESLint-Zone durchgesetzt (CON-0010 S-10).

### 3.2 Umformung der Verteilung (verbindliche Reihenfolge)

Eingabe: Kandidaten `c_i` einer logits-Station (absteigend nach `prob`, CON-0001 INV-10),
Einstellungen `{ temperature T, topK k, topP p }`.

1. **Score:** `s_i = logit_i`, wenn **alle** Kandidaten einen Logit haben, sonst `s_i = ln(prob_i)`
   (Remote-Verteilungen ohne Logits; bei `T = 1` ändert das nichts).
2. **Temperatur:** `q_i = softmax(s_i / T)` über die gegebenen Kandidaten; danach absteigend
   nach `q`, bei Gleichstand aufsteigend nach `token.id`. `T ∈ [0.1, 2]`.
3. **Top-k:** `k = 0` heißt aus; sonst bleiben die ersten `min(k, n)` Kandidaten.
4. **Top-p:** Auf den nach Schritt 3 renormierten Werten bleibt das kürzeste Präfix, dessen
   kumulierte Summe `≥ p − 1e-9` ist (mindestens ein Kandidat). `p ∈ (0, 1]`; `p = 1` heißt aus.
5. **Renormierung:** Die verbliebenen Kandidaten werden auf Summe 1 normiert. Ihr `logit` bleibt
   der Originalwert der logits-Station.

Der **Wurf** mit `r ∈ [0, 1)` wählt den ersten Kandidaten, dessen kumulierte Wahrscheinlichkeit
`> r` ist; reicht die Rundung nicht, den letzten.

Diese Reihenfolge (Temperatur, Top-k, Top-p) entspricht der verbreiteten Praxis (u. a. Hugging Face
`generate`), damit Erklärungen aus der Literatur auf die App passen.

### 3.3 Strategy (Behavioral): Sampler

**Anwendung:** `StochasticSampler` implementiert das bestehende Interface `Sampler`
(`strategy = 'sample'`) neben `GreedySampler`. Das Interface bekommt das optionale Feld
`params` (die Einstellungen als Record); der Generator schreibt es nach `trace.sampling.params`
(bei Greedy weiterhin `{}`). Die App wählt den Sampler nach der Einstellung im Formular.

**Rng-Verbrauch (Invariante):** Greedy zieht nie, `StochasticSampler` zieht je Schritt genau
einmal `rng.next()`. Nur so bleibt der Determinismus prüfbar.

**Begründung:** Generator, Trace und Ansichten bleiben unabhängig von der Strategie; weitere
Strategien kommen als weitere Klasse dazu.

**Alternative:** Ein Sampler mit Modus-Flag. Abgelehnt: verwischt Rng-Verbrauch und
`random = null` je Modus und verletzt Open/Closed.

Quelle: https://refactoring.guru/design-patterns/strategy

### 3.4 Pipeline aus reinen Funktionen (Chain of Responsibility, Behavioral)

**Anwendung:** `transformDistribution` ist die Verkettung `applyTemperature → applyTopK →
applyTopP → renormalize`; jedes Glied ist eine eigene exportierte, reine Funktion
(Eingabe wird nie verändert). Das Labor zeigt das Ergebnis, der Sampler wirft darauf.

**Alternative:** Logik im Sampler-Objekt kapseln. Abgelehnt: Das Labor (View) dürfte sie dann
nicht nutzen (Views importieren keine Engine) und müsste sie duplizieren.

Quelle: https://refactoring.guru/design-patterns/chain-of-responsibility

### 3.5 Sampling-Steuerung (App) und Factory Method (Creational)

`src/app/sampling-choice.ts` bündelt die Erzeugung: `normalizeTopK`, `normalizeSeed` und
`createSampler(choice)` (Greedy → `GreedySampler`, Zufall → `StochasticSampler` mit normalisierten
Werten). Das Formular kennt keine Sampler-Klassen. Quelle:
https://refactoring.guru/design-patterns/factory-method

`scores()` (3.2, Schritt 1) ist ein Adapter: Er übersetzt Logits bzw. `ln(prob)` in die Eingabe der
Kette, sodass die Glieder die Herkunft der Verteilung nicht kennen. Quelle:
https://refactoring.guru/design-patterns/adapter

Im Formular der Ansicht „Durchlauf“ steht vor „Erzeugen“ eine Gruppe „Sampling“ (`fieldset`):
Optionen „Greedy“ (Default) und „Zufall“ (Radio), dazu „Temperatur“ (Schieberegler 0.1–2,
Schritt 0.1, Default 1), „Top-k“ (Zahl 0–100, 0 = aus, Default 0), „Top-p“ (Schieberegler
0.05–1, Schritt 0.05, Default 1) und „Seed“ (Zahl, Default 42). Bei „Greedy“ sind die vier Felder
deaktiviert. Ungültige Zahlen werden beim Erzeugen normalisiert (Top-k: abrunden, auf 0–100
begrenzen, sonst 0; Seed: abrunden, auf 0–4294967295 begrenzen, sonst 42). Neben jedem
Schieberegler steht sein Wert mit Dezimalkomma.

### 3.6 Logits-Ansicht und Sampling-Labor

Renderer für `logits` (Registry aus SPEC-0002 §3.8):
- Erklärtext; Liste „Kandidaten“ mit den bis zu zehn wahrscheinlichsten Kandidaten: Anzeigetext
  (Leerzeichen sichtbar wie SPEC-0003), Balken (Breite relativ zum größten Wert, Farbe aus der
  Datenskala), Wahrscheinlichkeit in Prozent mit einer Nachkommastelle und Dezimalkomma
  („41,2 %“), Logit mit zwei Nachkommastellen oder „–“ ohne Logit.
- Gibt es mehr Kandidaten: Zeile „+ n weitere Tokens mit zusammen x %“.
- `coverage < 1`: Hinweis „Nur die n gelieferten Kandidaten, sie decken x % ab.“;
  `coverage = null`: „Abdeckung der Verteilung unbekannt.“
- **Region „Sampling-Labor“:** Regler „Labor-Temperatur“, „Labor-Top-k“, „Labor-Top-p“
  (Wertebereiche wie 3.5), vorbelegt mit den Parametern des Traces (bei Greedy: 1, 0, 1), Knopf
  „Zurücksetzen“. Liste „Labor-Verteilung“: dieselben (bis zu zehn) Kandidaten wie „Kandidaten“,
  je Zeile Anzeigetext, Original-Prozent, Pfeil und neuer Prozentwert oder „entfernt“. Hinweis
  „Das Labor rechnet nur diese Verteilung um, der Trace bleibt unverändert.“ Das Labor ändert
  weder Trace noch Cursor.

### 3.7 Sample-Ansicht (sichtbarer Zufallswurf)

Renderer für `sample`:
- Parameterzeile aus `trace.sampling`: Greedy → „Strategie: Greedy“; sonst
  „Temperatur 0,8 · Top-k aus · Top-p 0,9 · Seed 7“ (Top-k als Zahl oder „aus“).
- Zufall (`random ≠ null`): Text „Zufallszahl 0,734 fällt auf „katze““, darunter der
  **Zahlenstrahl** 0–1: je Kandidat der Verteilung ein Segment (Breite = Wahrscheinlichkeit,
  wechselnde Farben, gewähltes Segment hervorgehoben) und eine Markierung bei `random`
  (`aria-hidden`, die Information steht im Text).
- Greedy (`random = null`): Text „Greedy: kein Zufall, gewählt wird das wahrscheinlichste Token
  „katze“.“
- Liste „Kandidaten“ der Verteilung der sample-Station (bis zu zehn, Format wie 3.6), der
  gewählte Eintrag mit `aria-current="true"`.

### 3.8 Erweiterung des Renderer-Kontexts

`StationRenderContext` bekommt `sampling: SamplingParams | null` (aus dem Trace); `StationView`
reicht es über die neue optionale Prop `sampling` durch. Bestehende Renderer ignorieren es.

### 3.9 Anpassung CON-0006 (v0.2.0)

SPEC-0002 hat die Top-3-Liste ausdrücklich als Platzhalter bis SPEC-0004 eingeführt. Das Szenario
„Stationsansicht zeigt Tensorformen und Kandidaten“ erwartet künftig **10** Einträge in der Liste
„Kandidaten“ der logits-Station (MockEngine, 52 Tokens). Der Erklärtext der sample-Station wird
strategieneutral („Aus den Wahrscheinlichkeiten wird das nächste Token gewählt.“).

### 3.10 Festlegungen für die test-first geschriebenen Tests

- **Module:** `@/sampling/transform` exportiert `SamplingSettings`, `DEFAULT_SETTINGS`,
  `TEMPERATURE_MIN = 0.1`, `TEMPERATURE_MAX = 2`, `TOP_K_MAX = 100`, `validateSettings`,
  `scores`, `applyTemperature`, `applyTopK`, `applyTopP`, `renormalize`,
  `transformDistribution`, `drawIndex`. `@/engine/samplers/stochastic` exportiert
  `StochasticSampler`. `@/views/distribution/format` exportiert `formatPercent(p)` und
  `formatDecimal(x, digits)`.
- **DOM:** `group` „Sampling“ mit `radio` „Greedy“/„Zufall“, `slider` „Temperatur“ und
  „Top-p“, `spinbutton` „Top-k“ und „Seed“; in der Station: `list` „Kandidaten“, `region`
  „Sampling-Labor“ mit `slider` „Labor-Temperatur“/„Labor-Top-p“, `spinbutton` „Labor-Top-k“,
  `button` „Zurücksetzen“ und `list` „Labor-Verteilung“.

## 4. Funktionale Anforderungen

- **FR-01:** `src/sampling/transform.ts` implementiert die Umformung nach 3.2 als reine, exportierte Funktionen (`scores`, `applyTemperature`, `applyTopK`, `applyTopP`, `renormalize`, `transformDistribution`) und den Wurf `drawIndex(distribution, r)`; Eingaben werden nie verändert.
- **FR-02:** `validateSettings` wirft `RangeError` für `T ∉ [0.1, 2]`, nicht-endliche Werte, `topK` nicht ganzzahlig oder außerhalb `0–100`, `topP ∉ (0, 1]`. Eine leere Verteilung führt in `transformDistribution` zu einem `Error`.
- **FR-03:** `src/sampling/` importiert aus `src/` nur Typen aus `src/trace/`, kein React; ESLint setzt das durch (CON-0010 S-10).
- **FR-04:** `StochasticSampler(settings)` (Strategy `sample`, `params = { temperature, topK, topP }`) prüft die Einstellungen im Konstruktor, zieht `r = rng.next()` genau einmal je Schritt und liefert eine sample-Station mit der umgeformten Verteilung, `random = r` und dem gezogenen Token.
- **FR-05:** Der Generator schreibt `sampler.params` (falls vorhanden) nach `trace.sampling.params`; Greedy-Traces bleiben unverändert. Gleiche Eingaben samt Seed ergeben bytegleiche Traces.
- **FR-06:** Die App bietet die Sampling-Steuerung aus 3.5 und erzeugt Traces mit dem gewählten Sampler und Seed.
- **FR-07:** Die Station `logits` zeigt Kandidaten-Balken, Rest-Zeile und Abdeckungshinweis nach 3.6.
- **FR-08:** Das Sampling-Labor (3.6) formt die Verteilung der aktuellen logits-Station live mit `transformDistribution` um, ist mit den Trace-Parametern vorbelegt, lässt sich zurücksetzen und ändert weder Trace noch Cursor.
- **FR-09:** Die Station `sample` zeigt Parameterzeile, Zufallswurf mit Zahlenstrahl bzw. Greedy-Text und die Kandidatenliste mit markierter Wahl nach 3.7.
- **FR-10:** `StationRenderContext` und `StationView` reichen `sampling` durch (3.8); der Player übergibt `trace.sampling`.
- **FR-11:** CON-0006 v0.2.0 (3.9); alle übrigen Szenarien aus CON-0003, CON-0006 und CON-0009 bestehen unverändert.
- **FR-12:** Alle neuen Texte in `src/app/texts.ts`, Farbwerte nur in `src/app/theme/`, Zahlen mit Dezimalkomma über `format.ts`; keine Anfragen an fremde Origins.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                   | um ...                                                        |
|-------|----------------|------------------------------------------------------------------|---------------------------------------------------------------|
| US-01 | Lernende/r     | sehen, wie wahrscheinlich jedes Kandidaten-Token ist             | zu verstehen, dass das Modell eine Verteilung ausgibt          |
| US-02 | Vortragende/r  | die Temperatur hoch- und runterschieben und die Balken mitgehen sehen | Temperatur, Top-k und Top-p anschaulich zu erklären      |
| US-03 | Lernende/r     | sehen, welche Zufallszahl welches Token ausgewählt hat           | den Zufall im Modell nachvollziehen zu können                  |
| US-04 | Vortragende/r  | mit festem Seed reproduzierbare Läufe erzeugen                   | eine Demo verlässlich wiederholen zu können                    |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Korrektheit     | Referenzvektoren ±1e-6; Ergebnisverteilungen erfüllen CON-0001 INV-10 |
| Determinismus   | keine Zeit- oder Zufalls-APIs in `src/sampling/` und `src/engine/` (CON-0004 R-04); Zufall nur über den injizierten Rng |
| Performance     | Labor-Umformung einer Verteilung mit 50 257 Kandidaten < 50 ms (Node) |
| Accessibility   | Balken und Zahlenstrahl sind dekorativ (`aria-hidden`), alle Werte stehen als Text; Regler per Tastatur bedienbar |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: Sampling

  Scenario: Top-k 1 entspricht Greedy
    Given ein Greedy-Trace für "die katze sitzt" mit 4 Tokens
    When ich mit "Zufall", Top-k 1 und Seed 3 erzeuge
    Then ist der erzeugte Text derselbe

  Scenario: Zufallswurf sichtbar
    Given ein Zufalls-Trace mit Seed 7
    When ich die Station "sample" öffne
    Then sehe ich "Zufallszahl 0,…" und das gewählte Token

  Scenario: Labor
    Given die Station "logits" ist geöffnet
    When ich "Labor-Top-k" auf 2 setze
    Then sind ab dem dritten Eintrag der "Labor-Verteilung" alle "entfernt"
```

Die verbindlichen Szenarien stehen in den Contracts (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Verteilung mit nur einem Kandidaten: Wurf wählt ihn, Zahlenstrahl hat ein Segment.
- `topK` größer als die Zahl der Kandidaten: alle bleiben.
- `topP` sehr klein: genau der wahrscheinlichste Kandidat bleibt (wie Greedy).
- Kandidaten ohne Logits (Remote, Top-N): Temperatur über `ln(prob)`; Hinweis zur Abdeckung.
- `prob = 0` eines Kandidaten: Score `−∞`, Gewicht 0, nie gezogen.
- Ungültige Eingaben im Formular (Top-k „abc“, Seed −5): Normalisierung nach 3.5.
- Trace aus SPEC-0001-Zeiten (Greedy, `params: {}`): Labor startet mit 1/0/1, Parameterzeile „Strategie: Greedy“.

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0010 | behavior (markdown) | Sampling-Mathematik, Sampler, Generator-Parameter, Schichtregel für `src/sampling/` |
| CON-0011 | behavior (gherkin)  | Sampling-Steuerung, Logits-Ansicht, Sampling-Labor, Sample-Ansicht |
| CON-0006 | behavior (Änderung → v0.2.0) | Kandidatenliste der logits-Station mit 10 Einträgen |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0011 | unit       | CON-0010: Referenzvektoren, Wurf, Validierung, Sampler, Generator, Determinismus, Lint-Zone, Performance |
| TST-0012 | acceptance | CON-0011: Playwright-Szenarien für Steuerung, Logits, Labor, Sample |
| TST-0006 | acceptance | CON-0006 v0.2.0 (angepasstes Szenario) |

## 11. Implementierungsreihenfolge

Genau zwei Tasks, je einer pro vorhandener (committeter) Testsuite. Die Fixtures unter
`tests/fixtures/` liegen bereits vor.

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Sampling-Mathematik, StochasticSampler, Generator-Parameter, ESLint-Zone | FR-01–FR-05 | `tests/unit/sampling.test.ts` | `src/sampling/**`, `src/engine/samplers/**`, `src/engine/types.ts`, `src/engine/generate.ts`, `eslint.config.js` |
| 2 | Sampling-Steuerung, Logits-Ansicht, Labor, Sample-Ansicht, CON-0006-Anpassung | FR-06–FR-12 | `tests/e2e/sampling.spec.ts` | `src/app/**`, `src/views/**` |

## 12. Offene Fragen

- [x] Soll das Verschieben eines Reglers den Trace neu erzeugen („live“)?
  **Antwort (2026-10-22, autonom entschieden):** Nein. „Erst rechnen, dann abspielen“ bleibt; das
  Labor rechnet nur die Verteilung der aktuellen Station um, neu erzeugt wird über „Erzeugen“.
- [x] Reihenfolge der Filter?
  **Antwort (2026-10-22, autonom entschieden):** Temperatur → Top-k → Top-p (wie Hugging Face).

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review: Rng-Verbrauch als Invariante, Factory Method für Sampler, Adapter `scores()` |
