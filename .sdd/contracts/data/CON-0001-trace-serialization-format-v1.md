---
id: CON-0001
project: ""                # PRJ-XXXX
title: "Trace serialization format v1"
type: data
format: json-schema
spec: SPEC-0001
version: 0.4.0
status: approved
artifact: ".sdd/contracts/data/trace-serialization-format-v1.schema.json"
tests: ["TST-0001", "TST-0017"]
---

# Contract: Trace serialization format v1

> **Spec:** SPEC-0001 · **Typ:** Daten (JSON Schema) · **Status:** approved

## Zweck

Beschreibt das serialisierte Format eines Generierungslaufs (Trace), wie es
`serializeTrace` erzeugt und `deserializeTrace` annimmt. Es wird für den
Export/Import von Traces (Dateien `*.trace.json`) verwendet und ist der
gemeinsame Vertrag aller Engines (Mock, GPT-2, Remote). `src/trace/trace.schema.json`
ist eine inhaltsgleiche Kopie des Artifacts.

Das Schema prüft die Struktur. Die Invarianten unten prüfen Zusammenhänge, die
JSON Schema nicht ausdrücken kann. Beides zusammen definiert "gültiger Trace".
**Dieser Contract ist für das Format maßgeblich.** Die TypeScript-Typen in
SPEC-0001 3.2 bilden ihn ab (Tensordaten dort als `Float32Array` statt Base64).

## Invarianten

Bezeichnungen: `A = engine.architecture` (falls nicht `null`), `L = A.nLayers`,
`H = A.nHeads`, `D = A.dModel`, `M = A.dMlp`, `V = A.vocabSize`,
`C = A.contextLength`, `E = engine.eosTokenId`. Für Schritt `s` ist
`[a, b) = s.newPositions` und `n = b − a`.

- **INV-01 Tensorlänge:** Für jeden Tensor ist die Länge der Base64-dekodierten
  Bytes `4 · Produkt(shape)`. Die Bytes sind little-endian float32 und enthalten
  weder `NaN` noch `±Infinity`.
- **INV-02 Schrittindex:** `steps[i].index = i`.
- **INV-03 Kontextkette:** `steps[i].contextTokens = steps[i−1].contextTokens ++ [steps[i−1].chosen]` für `i ≥ 1`.
- **INV-04 KV-Cache-Sicht:** `steps[0].newPositions = [0, len(steps[0].contextTokens))`.
  Für `i ≥ 1` gilt `steps[i].newPositions = [len−1, len)` mit
  `len = len(steps[i].contextTokens)`.
- **INV-05 Stationsreihenfolge:** Die Stationen eines Schritts folgen der
  Reihenfolge `tokenize?, embed, (attention(l), residual(l, after=attention),
  mlp(l), residual(l, after=mlp)) für l = 0..L−1, logits, sample`. Davon fehlen
  genau die Arten, die nicht in `engine.capabilities` stehen. `tokenize` erscheint
  nur in Schritt 0, und dort genau dann, wenn die Fähigkeit vorhanden ist. Die
  letzten beiden Stationen sind immer `logits` und `sample`. Die `layer`-Werte
  liegen in `0..L−1`.
- **INV-06 Fähigkeiten:** Jede Station hat eine Art aus `engine.capabilities`.
  Enthält `capabilities` eine der Arten `embed`, `attention`, `mlp` oder `residual`,
  ist `engine.architecture` nicht `null`.
- **INV-07 Tokenize:** Die `tokenize`-Station enthält dieselben Tokens wie `steps[0].contextTokens`.
- **INV-08 Tensorformen:** `embed.token|position|sum`, `attention.lnIn|q|k|v|out`,
  `mlp.lnIn|out` und `residual.stream` haben die Form `[n, D]`, `mlp.hidden` hat
  `[n, M]` und `attention.weights` hat `[H, n, b]`.
- **INV-09 Kausale Attention:** Für jedes `attention.weights[h, i, j]` gilt:
  `0 ≤ w ≤ 1`, die Zeilensumme über `j` ist `1 ± 1e-5`, und `w = 0` für `j > a + i`.
- **INV-10 Verteilungen:** `logits.distribution` und `sample.distribution` sind
  absteigend nach `prob` sortiert (bei Gleichstand aufsteigend nach `token.id`),
  enthalten jede `token.id` höchstens einmal und summieren sich zu `1 ± 1e-6`.
- **INV-11 Wahl:** `sample.chosen = step.chosen`, und `step.chosen` kommt in
  `sample.distribution` vor.
- **INV-12 Ende:**
  - Für alle Schritte außer dem letzten gilt `chosen.id ≠ E`.
  - `'eos'`: `E ≠ null`, das letzte `chosen.id = E`, `1 ≤ len(steps) ≤ maxTokens`. EOS im Schritt `maxTokens − 1` zählt als `'eos'`.
  - `'max-tokens'`: `len(steps) = maxTokens`, und das letzte `chosen.id ≠ E`.
  - `'aborted'`: `0 ≤ len(steps) < maxTokens`.
  - `'error'`: `0 ≤ len(steps) < maxTokens`, und `error.message` ist gesetzt.
  - `error` ist genau dann vorhanden, wenn `finishReason = 'error'`.
- **INV-13 Wertebereiche:** Ist `A ≠ null`, gilt `token.id < V` für alle Tokens,
  `len(contextTokens) ≤ C` für alle Schritte, und ein gesetztes
  `logits.vocabSize` ist gleich `V`. Ein gesetztes `E` ist `< V`.
- **INV-14 Erweiterbarkeit:** Unbekannte zusätzliche Felder außerhalb von
  `Tensor`, `Token` und `Candidate` werden beim Import akzeptiert und sind nach
  Re-Export **JSON-tief gleich** vorhanden. Die Schlüsselreihenfolge ist nicht
  garantiert. Bytegleichheit gilt nur für Traces ohne Zusatzfelder
  (CON-0002 INV-05).
- **INV-15 Text:** `steps[i].text` ist nicht leer, wenn `contextTokens` oder
  `chosen` ein Token mit `id ≠ E` enthält. Nach dem Import wird er nicht
  neu berechnet. Wie decodiert wird, legt die Engine fest (CON-0002).

- **INV-16 BPE-Details** (seit v0.3.0, SPEC-0003): Hat die tokenize-Station das optionale
  Feld `bpe`, gilt mit `W = bpe.words`:
  - Die Verkettung aller `W[k].text` ist `prompt`.
  - Für jedes Wort `w`: `w.bytes` ist das UTF-8 von `w.text`; `w.stages[0]` ist
    `w.bytes.map(b => [b])`; jede Stufe ergibt verkettet `w.bytes`; jede Stufe hat weniger
    Symbole als die vorige; `w.ranks.length = w.stages.length − 1`, die Ränge sind streng
    steigend; `w.ids.length` ist die Symbolzahl der letzten Stufe.
  - `W.flatMap(w => w.ids)` ist gleich `tokens.map(t => t.id)`.
  - `tokens[j].text` ist die UTF-8-Dekodierung (nicht fatal, U+FFFD für unvollständige Folgen)
    der Bytes des `j`-ten Endsymbols.
  Der `path` jedes INV-16-Befunds beginnt mit `/steps/0/stations/<i>/bpe` (Index der
  tokenize-Station). Traces ohne `bpe` sind von INV-16 nicht betroffen. Das Schema beschreibt
  `bpe` als `$defs/BpeDetail` und `$defs/BpeWord`; die Semantik der Merges (welche Regel, welcher
  Rang) prüft der Import nicht, sie gehört zum Tokenizer (CON-0008).

- **INV-17 Logit-Lens** (seit v0.4.0, SPEC-0007): Hat eine residual-Station das optionale Feld
  `lens` (Schema: Array von `$defs/Candidate`, 1 bis 20 Einträge = `MAX_LENS_TOP_N`), gilt:
  - Die `token.id` sind eindeutig.
  - Die Folge der `prob` ist absteigend (gleich erlaubt); dass jede in [0, 1] liegt, prüft
    schon das Schema (`$defs/Candidate`).
  - Die Summe der `prob` ist ≤ 1 + 1e-6 (nicht renormiert: Anteil am ganzen Vokabular).
  - Ist `engine.architecture` gesetzt, ist jede `token.id` < `vocabSize`.
  Der `path` jedes INV-17-Befunds beginnt mit `/steps/<s>/stations/<i>/lens`. Traces ohne
  `lens` sind nicht betroffen. Welche Stationen eine Lens tragen (bei GPT-2 und Mock: nur
  `after: "mlp"`, letzte Position), legt die Engine fest (CON-0016); der Import prüft das nicht.

## Import-Fehler

`deserializeTrace(json: string)` prüft in dieser Reihenfolge (Chain of
Responsibility, SPEC-0001 3.6) und wirft beim ersten fehlerhaften Glied einen
`TraceImportError`:

```ts
class TraceImportError extends Error {
  readonly kind: 'parse' | 'version' | 'schema' | 'semantic';
  readonly errors: ReadonlyArray<{ path: string; message: string; invariant?: string }>; // 1..50 Einträge
  // message = errors[0].message (Debug); die UI nutzt kind/errors und texts.ts (CON-0003)
}
```

| `kind`     | Auslöser | `errors` |
|------------|----------|----------|
| `parse`    | kein gültiges JSON oder Wurzel ist kein Objekt | genau 1, `path: ""` |
| `version`  | `schemaVersion` fehlt, ist keine Ganzzahl oder ungleich 1 | genau 1, `path: "/schemaVersion"`; `message` enthält bei vorhandenem Wert die Version |
| `schema`   | Verletzung des JSON Schemas | alle Verstöße (max. 50), `path` = JSON Pointer (RFC 6901) des betroffenen Werts. Bei `oneOf` über Stationen wird nur der Zweig gemeldet, dessen `kind` passt. Folgefehler anderer Zweige werden unterdrückt |
| `semantic` | Verletzung von INV-01 bis INV-13 oder INV-15 bis INV-17 | alle Verstöße (max. 50), mit `invariant: "INV-xx"` |

Die `message`-Felder sind technisch (Englisch erlaubt). Für Nutzer formuliert sie
die UI über `texts.ts`.

## Beispiele

**Gültig** (MockEngine mit Option `capabilities: [tokenize, logits, sample]`,
also eine Remote-artige Engine ohne Interna):
```json
{
  "schemaVersion": 1,
  "id": "trace-0001",
  "createdAt": "2026-10-21T12:00:00Z",
  "engine": { "kind": "mock", "model": "mock-de-52", "capabilities": ["tokenize", "logits", "sample"],
              "architecture": null, "eosTokenId": 1 },
  "prompt": "die katze",
  "maxTokens": 1,
  "sampling": { "strategy": "greedy", "seed": 42, "params": {} },
  "steps": [{
    "index": 0,
    "contextTokens": [{ "id": 2, "text": "die" }, { "id": 7, "text": "katze" }],
    "newPositions": [0, 2],
    "stations": [
      { "kind": "tokenize", "tokens": [{ "id": 2, "text": "die" }, { "id": 7, "text": "katze" }] },
      { "kind": "logits", "vocabSize": 52, "coverage": 1,
        "distribution": [{ "token": { "id": 18, "text": "sitzt" }, "logit": 2.1, "prob": 0.7 },
                         { "token": { "id": 19, "text": "schläft" }, "logit": 1.25, "prob": 0.3 }] },
      { "kind": "sample", "random": null, "chosen": { "id": 18, "text": "sitzt" },
        "distribution": [{ "token": { "id": 18, "text": "sitzt" }, "logit": 2.1, "prob": 0.7 },
                         { "token": { "id": 19, "text": "schläft" }, "logit": 1.25, "prob": 0.3 }] }
    ],
    "chosen": { "id": 18, "text": "sitzt" },
    "text": "die katze sitzt"
  }],
  "finishReason": "max-tokens"
}
```

**Ungültig (und warum):**
```json
{ "schemaVersion": 2, "id": "x" }
```
→ `kind: "version"`, `errors[0].path = "/schemaVersion"`: Die Versionsprüfung greift vor dem Schema.

```json
"weights": { "shape": [2, 1, 3], "dtype": "float32", "data": "AACAPw==" }
```
→ `kind: "semantic"`, `invariant: "INV-01"`: 4 Bytes statt `4 · 6 = 24`.

## Validierung

- Schema: `.sdd/contracts/data/trace-serialization-format-v1.schema.json` (JSON Schema 2020-12), in der App per `ajv` (`Ajv2020`, `ajv-formats`, `allErrors: true`)
- Invarianten: Semantik-Glied der Import-Kette in `src/trace/`
- Tests: TST-0001

## Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-22 | 0.3.0 | SPEC-0003: optionales Feld `bpe` an der tokenize-Station (`$defs/BpeDetail`, `$defs/BpeWord`), INV-16; `schemaVersion` bleibt 1 |
| 2026-10-22 | 0.4.0 | SPEC-0007: optionales Feld `lens` an der residual-Station, INV-17; `schemaVersion` bleibt 1 |
