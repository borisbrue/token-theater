---
id: SPEC-0007
title: "Views for embedding, attention, MLP and residual stream"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.3.1
priority: high          # low | medium | high | critical
tags: [views, attention, residual, logit-lens, milestone-m2]
depends_on: ["SPEC-0001", "SPEC-0002", "SPEC-0004", "SPEC-0006"]
contracts: ["CON-0001", "CON-0016", "CON-0017", "CON-0018"]
tests: ["TST-0017", "TST-0018", "TST-0019"]
fr_test_map:
  FR-01: [TST-0017]
  FR-02: [TST-0017]
  FR-03: [TST-0017]
  FR-04: [TST-0018]
  FR-05: [TST-0018]
  FR-06: [TST-0018]
  FR-07: [TST-0019]
  FR-08: [TST-0019]
  FR-09: [TST-0019]
  FR-10: [TST-0019]
  FR-11: [TST-0019]
---

# Views for embedding, attention, MLP and residual stream

> **Status:** implemented · **Owner:** Boris · **Version:** 0.3.1
> Grundlage: `.sdd/docs/architecture/vision.md` (Stationen 2 und 3, Meilenstein M2 „Glaskasten“)

## 1. Kontext & Motivation

Seit SPEC-0006 rechnet die App ein echtes GPT-2 und schreibt jeden Zwischenschritt in den Trace.
Die Stationen `embed`, `attention`, `mlp` und `residual` zeigen bisher nur Tensorformen
(`weights [12, 5, 5]`). Wer lernen will, was ein Transformer tut, sieht damit nichts. Diese Spec
macht die vier Stationen sichtbar und schließt den Meilenstein M2 ab:

- **Embedding:** Token-Vektor, Positions-Vektor und ihre Summe als Farbstreifen.
- **Attention:** die Attention-Matrix je Kopf als Heatmap, mit den Tokens an den Achsen, der
  kausalen Maske und den Zeilen früherer Schritte (KV-Cache).
- **MLP:** die Aktivierungen der versteckten Schicht und die stärksten Neuronen.
- **Residual Stream:** der Strom als Farbstreifen, sein Verlauf über die Layer und eine
  **Logit-Lens**: Welche Tokens würde das Modell vorhersagen, wenn es nach diesem Layer aufhörte?

Die Logit-Lens (nostalgebraist, 2020) ist die anschaulichste Antwort auf „Was passiert in den
Layern?“: Man sieht die Vorhersage Layer für Layer entstehen. Sie braucht `ln_f` und die
Unembedding-Matrix, die nur die Engine hat. Deshalb rechnet die Engine sie mit und schreibt sie
als optionales Feld in den Trace (CON-0001 v0.4.0).

## 2. Zielsetzung

**Primärziel:** Eigene Ansichten für `embed`, `attention`, `mlp` und `residual`, die mit jeder
Engine funktionieren, die diese Stationen liefert (Mock, GPT-2), dazu die Logit-Lens in Trace und
Engines.

**Erfolgskriterien (messbar):**
- [ ] Mit dem Testmodell zeigt die Attention-Ansicht für jeden Kopf und Layer die Gewichte aus `transformers` (Top-3 je Zeile, auf 0,1 Prozentpunkte).
- [ ] Die Logit-Lens des Testmodells stimmt je Layer mit der Referenz aus `transformers` überein (IDs exakt, Wahrscheinlichkeiten ≤ 1e-5); die Lens des letzten Layers trifft das Top-Token der logits-Station.
- [ ] Im Folgeschritt zeigt die Heatmap die Zeilen früherer Schritte und hebt die neu berechnete Zeile hervor.
- [ ] Alle vier Ansichten sind ohne Maus bedienbar und geben ihre Kernaussagen auch als Text aus (Listen, Beschriftungen).
- [ ] Bestehende Contracts bleiben erfüllt; die Tensorformen bleiben in jeder Ansicht sichtbar.

**Nicht-Ziele:**
- Präsentationsmodus, Erklärtexte je Station über die vorhandenen hinaus, Trace-Export mit float16 (SPEC-0009, vorher als SPEC-0008 geplant).
- Logit-Lens nach der Attention, für alle Positionen oder mit „Tuned Lens“.
- Visualisierung einzelner q/k/v-Vektoren, Neuron-Erklärungen, Aktivierungs-Patching.
- 3D-Darstellungen, Animationen zwischen Stationen.
- Ansichten für Engines ohne Interna (Server): Diese Stationen fehlen dort weiterhin.

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/trace/            Residual-Station: optionales Feld lens, INV-17 (CON-0001 v0.4.0)
src/engine/lens.ts    gemeinsame Lens-Auswahl (Softmax, Top-N) für alle Engines
src/engine/gpt2/      Gpt2Model rechnet die Lens; Gpt2Engine setzt ihre Token-Texte
src/engine/mock/      MockEngine rechnet die Lens mit ihren Pseudo-Gewichten
src/views/tensor/     reine Rechnungen: Vektor-Statistik, Farbskalen, Attention-Matrix, Verlauf
src/views/tensor/     gemeinsame Bausteine: VectorStrip, Heatmap, PositionPicker
src/views/embedding/  embed-Renderer
src/views/attention/  attention-Renderer
src/views/mlp/        mlp-Renderer
src/views/residual/   residual-Renderer
src/app/player/       registriert die Renderer, reicht Farbskalen und Schritte durch
src/app/theme/        DIVERGING_SCALE, CSS der Ansichten
```

`src/views` importiert weder `src/app` noch `src/engine` (CON-0004). Farben bekommen die
Ansichten deshalb als Daten: Der Player übergibt `DATA_SCALE` und `DIVERGING_SCALE` aus
`src/app/theme/tokens.ts` an die Renderer-Fabriken.

### 3.2 Logit-Lens in der Engine

Die Lens projiziert den Residual Stream nach einem Block so ins Vokabular, wie es das Modell am
Ende tut:

```
lens(x) = softmax(ln_f(x) · wteᵀ)    (Softmax über das ganze Vokabular)
```

- Gerechnet wird **nur** für Residual-Stationen mit `after: 'mlp'` und **nur** für die letzte
  Position des Schritts (`b − 1`). Das ist die Position, die das nächste Token vorhersagt.
- Im Trace stehen die `lensTopN` wahrscheinlichsten Tokens (Default 5), absteigend nach `prob`,
  Gleichstand kleinere ID zuerst, `prob` **nicht** renormiert, `logit` = Rohwert.
- `lensTopN` ist eine ganze Zahl von 0 bis `MAX_LENS_TOP_N` (= 20, Konstante in
  `src/trace/types.ts`, dieselbe Grenze wie INV-17). `lensTopN: 0` schaltet die Lens ab (Feld
  fehlt). Andere Werte lehnt der Konstruktor mit `RangeError` ab; so erzeugt keine Engine einen
  Trace, der INV-17 verletzt.
- Die Auswahl aus den Logits (Softmax über das ganze Vokabular, Top-N, Sortierung,
  Gleichstandsregel) steht genau einmal in `src/engine/lens.ts`:
  `lensCandidates(logits, length, topN): { id, logit, prob }[]`. Die Engines liefern nur ihre
  Projektion `ln_f(x) · wteᵀ` und setzen die Texte.
- Die Lens des letzten Layers ist mathematisch die logits-Station: gleiche Top-1-ID, gleiche
  Wahrscheinlichkeit vor der Renormierung.
- Kosten: eine Vokabular-Projektion je Layer (distilgpt2: 6 × 38,6 Mio. Multiplikationen). Die
  Projektion nutzt in `Gpt2Model` denselben Baustein wie die logits-Station (§3.6 aus SPEC-0006:
  gemeinsame Bausteine statt Vererbung).
- `Gpt2Engine` setzt `token.text` der Lens-Kandidaten mit `tokenizer.decode([{ id, text: '' }])`,
  wie bei der logits-Station. Die MockEngine nimmt den Text aus ihrem Vokabular.

### 3.3 Trace-Format (CON-0001 v0.4.0)

`ResidualStation` bekommt `lens?: Candidate[]`; `src/trace/types.ts` exportiert
`MAX_LENS_TOP_N = 20`. `schemaVersion` bleibt 1; alte Traces bleiben
gültig. Neue Invariante **INV-17**: `lens` hat 1 bis 20 Einträge, eindeutige IDs, absteigende
`prob` in [0, 1], Summe ≤ 1 + 1e-6, IDs < `vocabSize` (falls die Architektur bekannt ist).

### 3.4 Reine Rechnungen in `src/views/tensor/` (Strategy über Daten statt Bedingungen)

Die Ansichten rechnen nichts im JSX. Alle Rechnungen sind reine Funktionen mit Unit-Tests:

| Modul | Funktion | Ergebnis |
|---|---|---|
| `tensor-math.ts` | `tensorRow(t, i)`, `l2Norm(v)`, `extent(v)`, `maxAbs(v)`, `topActivations(v, n)`, `countPositive(v)` | Zeilen, Norm, Min/Max, stärkste Indizes (absteigend, Gleichstand kleinerer Index) |
| `color-scale.ts` | `sampleScale(stops, t)`, `divergingPosition(value, limit)` | Farbe als `#rrggbb` durch lineare Interpolation; `t` auf [0, 1] begrenzt; divergierend: 0,5 + value / (2 · limit), bei limit 0 genau 0,5 |
| `attention-matrix.ts` | `attentionMatrix(step, earlierSteps, layer, head, history)`, `topAttended(matrix, row, n)` | Matrix aller sichtbaren Zeilen (siehe 3.5), Top-n beachtete Positionen |
| `residual-trajectory.ts` | `residualTrajectory(stations, row)` | Verlauf des Stroms über die Stationen eines Schritts (siehe 3.7) |

Die Farbskala ist eine Strategie, die der Player als Daten hineingibt: Heatmaps nutzen die
sequentielle `DATA_SCALE`, Vektoren die divergierende `DIVERGING_SCALE`
(`violet` → `surface-2` → `mint`, Mitte = 0).
Muster: [Strategy](https://refactoring.guru/design-patterns/strategy).

### 3.5 Attention-Matrix mit KV-Cache-Zeilen

`weights` hat die Form `[nHeads, emitted, b]`. In Schritt 0 sind das alle Prompt-Zeilen, in den
Folgeschritten genau eine neue Zeile. `attentionMatrix` setzt die volle Matrix zusammen:

- Spalten: Positionen `0 … b − 1` des aktuellen Schritts.
- Zeilen: mit `history = true` alle Positionen `0 … b − 1`, die Zeilen früherer Schritte aus
  deren attention-Station desselben Layers; mit `history = false` nur die Zeilen des aktuellen
  Schritts.
- Jede Zeile ist kausal: Felder rechts der eigenen Position sind maskiert (`masked`), Wert 0.
- `head` ist ein Kopfindex oder `'mean'` (arithmetisches Mittel über alle Köpfe).
- Ergebnis: `{ rows: number[], cols: number, values: Float32Array, current: [from, to) }`, dabei
  ist `current` der Zeilenbereich des aktuellen Schritts in `rows`.

Fehlt einem früheren Schritt die Station, fehlen seine Zeilen; die Ansicht zeigt dann nur, was
vorhanden ist.

### 3.6 Gemeinsame Bausteine

- **`VectorStrip`**: ein Vektor als Farbstreifen auf einem `<canvas>` (ein Pixel je Wert, per CSS
  gestreckt, `image-rendering: pixelated`), divergierende Skala mit gemeinsamer Grenze für alle
  Streifen einer Ansicht (`maxAbs` über alle), darunter „Skala: ±<Grenze>“. `role="img"`, Name
  „<Titel> · <n> Werte“. Die Canvas umfasst genau die Werte. Beim Überfahren mit der Maus zeigt
  eine Zeile „Dimension i: <Wert>“.
- **`Heatmap`**: Matrix auf einem `<canvas>`, Zeilen- und Spaltenbeschriftung mit Tokens
  (außerhalb der Canvas; die Canvas umfasst genau die Felder), feste Skala 0 bis 100 %
  (`DATA_SCALE`), maskierte Felder in Hintergrundfarbe, Zeilen außerhalb von `current` gedämpft.
  `role="img"`, Name „Attention · Layer l · Kopf h · R × C“ bzw. „Attention · Layer l · Mittel ·
  R × C“. Beim Überfahren: „„<Zeile>“ → „<Spalte>“: <Prozent>“, bei maskierten Feldern
  „„<Zeile>“ → „<Spalte>“: maskiert“.
- **`PositionPicker`**: `radiogroup` „Position“ mit einem `radio` je Zeile des Schritts, Name
  „<Position> · <Token>“ (Token sichtbar gemacht wie in der Tokenisierung). Vorauswahl: letzte
  Zeile.

Canvas statt DOM-Zellen, weil eine Ansicht von distilgpt2 sonst bis zu 64 × 64 Attention-Felder
oder 3 072 MLP-Werte als Elemente bräuchte. Die Kernaussagen stehen zusätzlich als Text in Listen.

### 3.7 Die vier Ansichten

Jede Ansicht zeigt den vorhandenen Erklärtext, ihren Inhalt und darunter weiter die Liste
„Tensoren“ mit den Formen (bestehende Tests und Contracts prüfen sie).

- **embed:** `PositionPicker`; drei `VectorStrip` („Token-Embedding“, „Positions-Embedding“,
  „Summe“) mit gemeinsamer Grenze; Liste „Vektoren“ mit „<Titel> ‖v‖ = <Norm>“.
- **attention:** `radiogroup` „Kopf“ mit „Kopf 0“ … „Kopf H−1“ und „Mittel“ (Vorauswahl „Kopf 0“);
  `checkbox` „Frühere Schritte zeigen“ (nur ab Schritt 1, Vorauswahl an); `Heatmap`;
  `PositionPicker` für die Zeile des aktuellen Schritts; Liste „Beachtete Tokens“ mit den Top 3
  der gewählten Zeile („<Position> · <Token> <Prozent>“). Ab Schritt 1 der Hinweis „Nur die neue
  Zeile wurde berechnet. Die Zeilen darüber stammen aus früheren Schritten (KV-Cache).“
- **mlp:** `PositionPicker`; `VectorStrip` „Hidden“; Text „Aktiv (> 0): <k> von <n>“; Liste
  „Stärkste Neuronen“ mit den Top 5 („#<Index> <Wert>“); Liste „Vektoren“ mit den Normen von
  „Eingang“ (`lnIn`) und „Ausgang“ (`out`).
- **residual:** `PositionPicker`; `VectorStrip` „Residual Stream“; Liste „Verlauf“ mit je einem
  Eintrag „embed“ und einem je Residual-Station des Schritts („Layer l · nach Attention“ bzw.
  „… · nach MLP“), Text „‖x‖ = <Norm>“ und ab dem zweiten Eintrag „(Δ <Norm der Änderung>)“, ein
  Balken relativ zur größten Norm, der aktuelle Eintrag mit `aria-current="true"`; Liste
  „Logit-Lens“ mit den Lens-Kandidaten („<Token> <Prozent>“, Token sichtbar gemacht). Ohne Lens an einer Station
  `after: 'attention'` der Hinweis „Die Logit-Lens gibt es nach jedem MLP.“, an einer Station
  `after: 'mlp'` ohne Lens „Dieser Trace enthält keine Logit-Lens.“ Die Lens gehört zur letzten
  Position; ist eine andere Position gewählt, steht dabei „Die Logit-Lens gilt für die letzte
  Position.“

Zahlen mit Dezimalkomma: Normen und Werte mit zwei Nachkommastellen (`formatDecimal`), Prozent
mit einer (`formatPercent`).

**Wiederverwendung statt Doppelung:** Tokens erscheinen überall über `displayText` aus
`src/views/tokenization/token-display.ts` (SPEC-0003), Zahlen über `formatDecimal` und
`formatPercent` aus `src/views/distribution/format.ts` (SPEC-0004). Die Lens-Liste ist eine
schlichte Liste und nicht die Kandidatenliste aus SPEC-0004: Sie zeigt nicht renormierte Anteile
am ganzen Vokabular und kein Sampling. Die Auswahl in `src/engine/lens.ts` ist Engine-Mathematik
(volle Softmax über das Vokabular), nicht das Client-Sampling aus `src/sampling/`, das auf den
gelieferten Kandidaten arbeitet.

**Tastatur:** Position und Kopf sind native Radio-Inputs, „Frühere Schritte zeigen“ eine
Checkbox. Die Transport-Kürzel des Players (Pfeiltasten, Leertaste) greifen in Eingabeelementen
nicht (CON-0006 UI-04); Pfeiltasten wechseln dort also die Auswahl, nicht die Station.

### 3.8 Renderer-Kontext und Auswahl (Erweiterung von SPEC-0002 §3.8)

`StationRenderContext` bekommt vier Felder. Bestehende Renderer ignorieren sie.

| Feld | Inhalt | gebraucht von |
|---|---|---|
| `step` | der aktuelle `GenerationStep` (Kontext-Tokens, `newPositions`, Stationen) | alle vier (Tokens, Verlauf) |
| `earlierSteps` | die Schritte vor dem aktuellen, nur lesend | attention (KV-Cache-Zeilen) |
| `selection` | `{ position: number \| null, head: number \| 'mean', history: boolean }` | alle vier |
| `select(patch)` | ändert die Auswahl | alle vier |

Den ganzen Trace bekommt kein Renderer; `earlierSteps` ist die engste Sicht, die die
KV-Cache-Zeilen brauchen.

**Mediator:** Die Auswahl gehört dem Player, nicht den Ansichten. Er hält sie, nimmt Änderungen
über `select` entgegen und reicht sie an den aktiven Renderer. Die Ansichten kennen sich nicht
und bleiben zustandslos. Regeln, alle an dieser einen Stelle:
- `position` ist die absolute Position im Kontext. Gibt es sie in den Zeilen der Station nicht
  (oder ist sie `null`), gilt die letzte Zeile.
- `head` außerhalb von `0 … nHeads − 1` gilt als `0`.
- Startwerte und nach jedem neuen Trace: `{ position: null, head: 0, history: true }`.
- Ein Stationswechsel ändert die Auswahl nicht.
Muster: [Mediator](https://refactoring.guru/design-patterns/mediator).

Die Renderer werden wie bisher über Fabriken registriert:
`createEmbedRenderer(labels, scales)`, `createAttentionRenderer(labels, scales)`,
`createMlpRenderer(labels, scales)`, `createResidualRenderer(labels, scales)`.
Muster: [Factory Method](https://refactoring.guru/design-patterns/factory-method) wie in
SPEC-0003/0004.

### 3.9 Festlegungen für die test-first geschriebenen Tests

- **Fixtures:** `tests/fixtures/gpt2/tiny-gpt2.lens.json` (Logit-Lens aus `transformers` je Layer
  für beide Prompts des Golden-Files, Schritt 0 und der erste Folgeschritt; erzeugt mit
  `softmax(lm_head(ln_f(block_out)))`, Top 5), dazu die Fixtures aus SPEC-0006.
- **Module:** `@/engine/lens` (`lensCandidates`), `@/trace/types` (`MAX_LENS_TOP_N`),
  `@/views/tensor/tensor-math`, `@/views/tensor/color-scale`,
  `@/views/tensor/attention-matrix`, `@/views/tensor/residual-trajectory`;
  `@/app/theme/tokens` (`DIVERGING_SCALE`); `@/engine/gpt2/model` (`Gpt2Model`, Option
  `lensTopN`); `@/engine/mock/mock-engine` (`MockEngine`, Option `lensTopN`);
  `@/trace/invariants`, `@/trace/serialize`.
- **DOM:** `radiogroup` „Position“, „Kopf“; `checkbox` „Frühere Schritte zeigen“; `img` mit den
  Namen aus 3.6; Listen „Vektoren“, „Beachtete Tokens“, „Stärkste Neuronen“, „Verlauf“,
  „Logit-Lens“.

## 4. Funktionale Anforderungen

- **FR-01:** Trace-Format: optionales Feld `lens` an der Residual-Station und INV-17 nach 3.3, in Typen, beiden Schema-Dateien und der semantischen Prüfung; Export und Import erhalten die Lens.
- **FR-02:** `lensCandidates` in `src/engine/lens.ts` nach 3.2; `Gpt2Model` rechnet die Logit-Lens damit (Option `lensTopN` 0–20, Default 5, 0 = aus, sonst `RangeError`); `Gpt2Engine` setzt die Token-Texte.
- **FR-03:** `MockEngine` rechnet die Logit-Lens nach 3.2 mit ihren Pseudo-Gewichten und `lensCandidates` (Option `lensTopN` wie FR-02).
- **FR-04:** `tensor-math` und `color-scale` nach 3.4; `DIVERGING_SCALE` in `src/app/theme/tokens.ts`.
- **FR-05:** `attentionMatrix` und `topAttended` nach 3.5.
- **FR-06:** `residualTrajectory` nach 3.7 (Einträge, Normen, Änderungen, aktueller Eintrag).
- **FR-07:** embed-Ansicht nach 3.6/3.7.
- **FR-08:** attention-Ansicht nach 3.6/3.7 (Köpfe, Mittel, frühere Schritte, Zeile, Top 3, Hinweis).
- **FR-09:** mlp-Ansicht nach 3.6/3.7.
- **FR-10:** residual-Ansicht nach 3.6/3.7 (Verlauf, Logit-Lens, Hinweise).
- **FR-11:** Renderer-Kontext und Auswahl im Player (Mediator) nach 3.8; alle Texte in `src/app/texts.ts`, Farben nur aus dem Theme; bestehende Contracts bleiben erfüllt.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                          | um ...                                                       |
|-------|----------------|-------------------------------------------------------------------------|--------------------------------------------------------------|
| US-01 | Lernende/r     | sehen, auf welche früheren Tokens jedes Token in jedem Kopf achtet      | zu verstehen, was Attention praktisch bedeutet               |
| US-02 | Lernende/r     | Layer für Layer sehen, welche Vorhersage im Residual Stream entsteht    | zu verstehen, was die Layer zur Antwort beitragen            |
| US-03 | Vortragende/r  | im Folgeschritt zeigen, dass nur eine neue Zeile berechnet wird         | den KV-Cache greifbar zu erklären                            |
| US-04 | Lernende/r     | Embedding und MLP als Bild statt als Zahlenkolonne sehen                | ein Gefühl für hochdimensionale Vektoren zu bekommen         |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Korrektheit     | Lens gegen `transformers`: IDs exakt, Wahrscheinlichkeiten ≤ 1e-5; Ansichten zeigen die Werte des Traces ohne eigene Näherung |
| Performance     | Logit-Lens: eine Vokabular-Projektion je Layer, bei distilgpt2 ≈ 0,3 s je Layer, also ≈ 1,5 s zusätzlich je Schritt (gemessen 2026-10-22 in reinem JavaScript: 0,65 → 2,17 s; Ziel ≤ 0,5 s erreicht SPEC-0008 mit dem WASM-Rechenkern, siehe §12); eine Ansicht zeichnet ihre Canvas ohne spürbare Verzögerung (< 100 ms bei 64 Tokens, manuelle Abnahme); keine Ansicht erzeugt mehr als ein DOM-Element je Tensorwert |
| Barrierefreiheit | Bedienung per Tastatur (Radio, Checkbox), Canvas mit `role="img"` und Namen, Kernaussagen als Text |
| Theme           | Farben nur aus `src/app/theme` (CON-0007 T-03); Ansichten erhalten Skalen als Daten |
| Architektur     | `src/views` ohne Importe aus `src/app` und `src/engine` (CON-0004) |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: Ansichten der Glaskasten-Stationen

  Scenario: Attention-Heatmap des Testmodells
    Given ich habe mit dem GPT-2-Testmodell "Die Katze sitzt" mit 3 Tokens erzeugt
    When ich in Schritt 0 die Station "attention · Layer 0" öffne
    Then zeigt die Heatmap "Attention · Layer 0 · Kopf 0 · 6 × 6"
    And die Liste "Beachtete Tokens" zeigt die Top 3 der letzten Zeile aus transformers

  Scenario: Logit-Lens im Residual Stream
    Given derselbe Lauf
    When ich die Station "residual · Layer 1 · nach MLP" öffne
    Then beginnt die Liste "Logit-Lens" mit dem Top-Token der logits-Station
```

Die verbindlichen Szenarien stehen in den Contracts (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Station mit einer Zeile (Folgeschritt): `PositionPicker` mit genau einem Eintrag.
- Vektor aus lauter Nullen: Grenze 0, alle Felder in der Mittelfarbe, Norm „0,00“.
- `NaN` oder `±Infinity` in importierten Tensordaten: lehnt INV-01 ab (CON-0001); die Ansichten
  müssen damit nicht rechnen.
- Früherer Schritt ohne attention-Station (z. B. Trace mit Lücken): nur vorhandene Zeilen.
- Importierter Trace ohne `lens`: Hinweis statt Liste.
- Mock mit eingeschränkten capabilities (ohne `residual`): keine Residual-Station, keine Lens.
- Sehr kleine Gewichte (lange Prompts): Die Heatmap bleibt bei der festen Skala 0 bis 100 %, damit
  Köpfe und Layer vergleichbar bleiben; die genauen Werte stehen in „Beachtete Tokens“ und unter
  der Maus.

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0001 | data (json-schema) | v0.4.0: optionales Feld `lens` an der residual-Station, INV-17 |
| CON-0016 | behavior (markdown) | Logit-Lens: Auswahlregel, GPT-2 gegen Referenz, Wertebereich, Konsistenz mit logits, Texte, Mock, Trace-Format |
| CON-0017 | behavior (markdown) | Rechnungen der Ansichten: Tensorzeilen, Statistik, Farbskalen, Attention-Matrix, Top-Positionen, Verlauf |
| CON-0018 | behavior (gherkin)  | Ansichten für embed, attention, mlp und residual mit Auswahl, KV-Cache-Zeilen, Maus-Werten und Logit-Lens |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0017 | unit       | CON-0016 und CON-0001 INV-17 mit dem Testmodell und `tiny-gpt2.lens.json` |
| TST-0018 | unit       | CON-0017 mit handgebauten Tensoren und Läufen der MockEngine |
| TST-0019 | acceptance | CON-0018 mit dem Testmodell per `page.route` und der MockEngine |

## 11. Implementierungsreihenfolge

Genau drei Tasks, je einer pro vorhandener (committeter) Testsuite. Fixtures unter
`tests/fixtures/` liegen bereits vor.

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Trace-Feld `lens`, INV-17, Logit-Lens in GPT-2 und Mock | FR-01–FR-03 | `tests/unit/logit-lens.test.ts` | `src/trace/**`, `src/engine/lens.ts`, `src/engine/gpt2/**`, `src/engine/mock/**` |
| 2 | Reine Rechnungen der Ansichten, divergierende Skala | FR-04–FR-06 | `tests/unit/station-views.test.ts` | `src/views/tensor/*.ts`, `src/app/theme/tokens.ts` |
| 3 | Ansichten, Renderer-Kontext, Player, Texte, CSS | FR-07–FR-11 | `tests/e2e/station-views.spec.ts` | `src/views/**`, `src/app/**` |

## 12. Offene Fragen

- [x] Logit-Lens in der Engine oder in der Ansicht? **Antwort (2026-10-22, autonom entschieden):** in der Engine. Nur sie hat `ln_f` und die Unembedding-Matrix; die Ansicht bekäme sonst Gewichte in den Hauptthread. Das Feld ist optional, alte Traces bleiben gültig.
- [x] Lens nach jeder Residual-Station oder nur nach dem MLP? **Antwort (2026-10-22, autonom entschieden):** nur nach dem MLP, nur für die letzte Position. Das ist die übliche Logit-Lens (Ausgang je Block) und halbiert die Kosten; nach der Attention erklärt ein Hinweis, wo sie steht.
- [x] Canvas oder DOM für Heatmaps und Vektoren? **Antwort (2026-10-22, autonom entschieden):** Canvas, Kernaussagen zusätzlich als Text. Bei distilgpt2 wären es sonst Tausende Elemente je Ansicht.
- [x] Logit-Lens abschaltbar machen? Gemessen kostet sie bei distilgpt2 ≈ 1,5 s je Schritt (eine Projektion auf 50 257 Tokens ≈ 0,3 s in JavaScript). Möglich: Schalter in den Einstellungen, Lens nur für gewählte Layer, oder WebAssembly/SIMD. **Antwort (2026-10-22, Boris):** WebAssembly mit SIMD, umgesetzt in SPEC-0008. Die Begründung „Speicherbandbreite“ war falsch; der JavaScript-Code war schlicht langsam.
- [x] Vorauswahl der Attention: Kopf 0 oder Mittel? **Antwort (2026-10-22, autonom entschieden):** Kopf 0. Das Mittel verwischt, was einzelne Köpfe tun; es bleibt als Option.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review: `lensTopN` auf 0–20 begrenzt (`MAX_LENS_TOP_N`), gemeinsame Lens-Auswahl in `src/engine/lens.ts`, enger Renderer-Kontext, Auswahl im Player (Mediator) |
| 2026-10-22 | 0.3.0   | Boris  | Contracts CON-0001 v0.4.0, CON-0016–0018; Skala, Maus-Texte, Wiederverwendung von Formatierung und Token-Darstellung, Tastatur |
| 2026-10-22 | 0.3.1   | Boris  | Implementiert; Performance-NFR auf den gemessenen Wert korrigiert, offene Frage zur abschaltbaren Lens |
