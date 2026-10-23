---
id: SPEC-0006
title: "GPT-2 engine in the browser"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.2.1
priority: high          # low | medium | high | critical
tags: [engine, gpt2, worker, milestone-m2]
depends_on: ["SPEC-0001", "SPEC-0003", "SPEC-0004", "SPEC-0005"]
contracts: ["CON-0014", "CON-0015"]
tests: ["TST-0015", "TST-0016"]
fr_test_map:
  FR-01: [TST-0015]
  FR-02: [TST-0015]
  FR-03: [TST-0015, TST-0016]
  FR-04: [TST-0015, TST-0016]
  FR-05: [TST-0015, TST-0016]
  FR-06: [TST-0015]
  FR-07: [TST-0016]
  FR-08: [TST-0016]
  FR-09: [TST-0016]
  FR-10: [TST-0016]
---

# GPT-2 engine in the browser

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.0
> Grundlage: `.sdd/docs/architecture/vision.md` (Modus „Glaskasten“), SPEC-0003 (GPT-2-Tokenizer)

## 1. Kontext & Motivation

Der Server-Modus (SPEC-0005) zeigt nur, was ein Server preisgibt: Top-N-Wahrscheinlichkeiten.
Der Glaskasten-Modus der Vision verlangt mehr: Embeddings, jede Attention-Matrix, MLP und
Residual Stream eines **echten** Modells. Das geht nur, wenn die App das Modell selbst rechnet.
GPT-2 (OpenAI, 2019) ist klein genug für den Browser, gut dokumentiert und nutzt genau den
Tokenizer aus SPEC-0003.

Diese Spec liefert eine GPT-2-Engine in TypeScript, die in einem Web Worker rechnet, Gewichte im
safetensors-Format vom eigenen Origin lädt und im Browser-Cache hält, und jeden Zwischenschritt in
den Trace schreibt. Die Ansichten dafür kommen in SPEC-0007; hier zeigen die Stationen ihre
Tensorformen (generischer Renderer) und die bestehenden Ansichten für tokenize, logits und sample.

Verfügbare Modelle (geprüft 2026-10-22, Hugging Face): `distilbert/distilgpt2` (6 Layer, 12 Heads,
768 Dimensionen, 353 MB, Tensor-Namen mit Präfix `transformer.`), `openai-community/gpt2`
(12 Layer, 548 MB, ohne Präfix). Beide F32, beide mit `h.N.attn.bias`-Maskenpuffern.

## 2. Zielsetzung

**Primärziel:** Eine `Gpt2Engine`, die GPT-2-kompatible Gewichte lädt und Traces mit allen sieben
Stationsarten erzeugt, numerisch übereinstimmend mit der Referenzimplementierung (Hugging Face
`transformers`).

**Erfolgskriterien (messbar):**
- [ ] Für das Testmodell stimmen Embedding, LayerNorm, q/k/v, Attention-Gewichte, Attention- und MLP-Ausgaben, Residual Stream und Logits mit `transformers` überein (Toleranzen in CON-0014).
- [ ] Mit KV-Cache stimmt der Folgeschritt mit einer vollen Neuberechnung überein; Greedy erzeugt dieselben Tokens wie `transformers.generate`.
- [ ] Gewichte kommen vom eigenen Origin, mit Fortschrittsanzeige; ein zweiter Lauf und ein Neuladen der Seite laden sie nicht erneut über das Netz.
- [ ] Die Rechnung blockiert die Oberfläche nicht (Web Worker).
- [ ] Ein Lauf mit distilgpt2 liefert für „Hello, my dog is“ dieselben Top-5-Token-IDs wie `transformers` (manuelle Abnahme, die Gewichte liegen nicht im Repo).

**Nicht-Ziele (explizit):**
- Ansichten für Embedding, Attention-Heatmaps, MLP und Residual Stream → SPEC-0007
- WebGPU, WASM-SIMD, Quantisierung (Rechnung in Float32 auf der CPU)
- Andere Architekturen (Llama, Mistral) und andere Tokenizer
- Laden direkt von Hugging Face im Browser (fremder Origin); Gewichte holt ein Skript einmalig
- Präsentationsmodus, Export-Komprimierung → SPEC-0008

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/engine/gpt2/   safetensors.ts, config.ts, weights.ts, math.ts (LayerNorm, MatMul, GELU, Softmax),
                   kv-cache.ts, model.ts (Forward-Pass + Stationen), protocol.ts (Kommandos),
                   worker-handler.ts, worker.ts, gpt2-engine.ts (Proxy), errors.ts
src/app/gpt2/      models.ts (Manifest), weights-loader.ts (Cache → Fetch mit Fortschritt)
src/app/           engine-factory.ts ('gpt2', erzeugt den Worker), Engine-Steuerung, Fortschritt
scripts/           fetch-model.mjs (lädt Gewichte nach public/models/, schreibt index.json)
public/models/     gitignoriert (nur .gitkeep)
```

Nur `src/app/engine-factory.ts` importiert `src/engine/gpt2` (Zone wie `mock`/`remote`).
`src/engine/gpt2/**` erfüllt CON-0004 R-02 bis R-04 (kein `any`, kein React, aus `src/trace` nur
Typen, kein Zufall/keine Zeit).

### 3.2 Proxy (Structural): Engine im Hauptthread, Rechnung im Worker

**Anwendung:** `Gpt2Engine` implementiert `InferenceEngine` im Hauptthread und leitet an einen
Worker weiter. Der Worker hält Gewichte und KV-Cache; `forward` schickt Kontext-IDs und
Positionen, der Worker antwortet mit den Stationen (Float32Arrays per structured clone).
Abhängigkeiten werden injiziert: `tokenizer` (Interface `Tokenizer` mit `explain`, in der App der
GPT-2-Tokenizer aus SPEC-0003), `createWorker()`, `loadWeights(onProgress, signal) → { config,
weights: ArrayBuffer }`.

**Command (Behavioral):** Das Protokoll ist eine getypte Discriminated Union: Kommandos `init`
(Konfiguration + Gewichte als Transferable), `forward` (`requestId`, Kontext-IDs, `[a, b)`);
Antworten `ready` (Architektur), `init-error`, `stations` (`requestId`), `forward-error`. Der
Handler verteilt per vollständigem `switch`. Ein Abbruch verwirft die Antwort der laufenden
`requestId` im Proxy (die Rechnung eines Schritts ist kurz); Abbrechen beim Laden bricht den
Download ab. Quelle: https://refactoring.guru/design-patterns/command Tests ersetzen den Worker
durch einen In-Process-Worker mit demselben `createGpt2WorkerHandler()`.

**Begründung:** Der Generator und alle Ansichten bleiben unverändert; die Oberfläche bleibt
während der Rechnung bedienbar.

Quelle: https://refactoring.guru/design-patterns/proxy

### 3.3 Laden der Gewichte

- **Manifest:** `models/index.json` (relativ zu `import.meta.env.BASE_URL`):
  `{ "models": [{ "id", "name", "config", "weights", "bytes" }] }`, Pfade relativ zu `models/`.
- **Kette (Chain of Responsibility):** Zuerst die Cache API (`token-theater-models-v1`); ein
  Treffer lädt ohne Netz. Sonst `fetch` mit stückweisem Lesen des Bodys (`ReadableStream`), danach
  Schreiben in den Cache. Fehlt die Cache API oder scheitert sie, übernimmt das nächste Glied.
  `fetch` und der Cache-Speicher (`CacheStorage | null`) werden dem Loader injiziert.
- **Fortschritt als Daten:** Der Loader meldet `{ loadedBytes, totalBytes, fromCache }` (`total`
  aus `Content-Length`, sonst `bytes` aus dem Manifest); die Oberfläche formt daraus über
  `texts.ts` „Lade Gewichte: x von y MB“ (eine Nachkommastelle, Dezimalkomma) bzw. „Gewichte aus
  dem Browser-Cache“.
- **Übergabe:** Das `ArrayBuffer` geht als Transferable an den Worker (keine Kopie). Der Worker
  hält das Modell, solange die Engine lebt; die App behält die Engine je Modell-ID für weitere
  Läufe.
- **Fehler:** Der Loader wirft `WeightsLoadError` mit `kind` (`http` mit `status` | `network`);
  die Oberfläche zeigt „Die Gewichte konnten nicht geladen werden (HTTP <status>).“ bzw.
  „… (Netzwerkfehler).“ (Texte in `texts.ts`). Eine ungültige Datei meldet der Worker als
  `Gpt2LoadError('format')` mit Grund; die Oberfläche zeigt „Die Gewichtsdatei ist ungültig:
  <Grund>.“ Eine als ungültig erkannte Datei wird wieder aus dem Cache entfernt. Ein Abbruch
  (`signal`) wirft einen `AbortError` und erzeugt keine Meldung.
- **Skript:** `npm run fetch-model -- distilgpt2` bzw. `gpt2` lädt `config.json` und
  `model.safetensors` von Hugging Face nach `public/models/<id>/` und trägt das Modell in
  `public/models/index.json` ein.

### 3.4 safetensors, Konfiguration, Gewichte

- **safetensors:** 8 Byte Header-Länge (u64 little-endian), JSON-Header
  `{ name: { dtype, shape, data_offsets: [begin, end] }, __metadata__? }`, danach die Daten.
  Unterstützt `F32` (ohne Kopie, wenn ausgerichtet), `F16` und `BF16` (nach Float32 umgerechnet).
  Andere dtypes nur, wenn der Tensor nicht gebraucht wird (z. B. Maskenpuffer); sonst Fehler.
- **Konfiguration:** `n_layer`, `n_head`, `n_embd`, `n_positions`, `vocab_size`, `n_inner`
  (`null` → `4 · n_embd`), `layer_norm_epsilon` (Default 1e-5), `activation_function`
  (`gelu_new` oder `gelu` → Tanh-Näherung). `n_embd` muss durch `n_head` teilbar sein.
- **Gewichte:** Namen mit oder ohne Präfix `transformer.`; benötigt: `wte`, `wpe`, je Layer
  `ln_1`, `attn.c_attn`, `attn.c_proj`, `ln_2`, `mlp.c_fc`, `mlp.c_proj` (weight/bias), `ln_f`.
  `attn.bias`, `attn.masked_bias` und `lm_head.weight` werden ignoriert (Unembedding = `wteᵀ`).
  Fehlt ein Tensor oder passt eine Form nicht, ist das ein `format`-Fehler mit Namen.

### 3.5 Rechnung und Stationen

GPT-2 in Float32 (Conv1D: `y = x · W + b`, `W` hat die Form `[in, out]`). Für die neuen Positionen
`[a, b)` (CON-0001 INV-04):

| Station | Inhalt |
|---|---|
| `embed` | `token` = Zeilen von `wte`, `position` = Zeilen von `wpe`, `sum` = Summe – je `[n, D]` |
| `attention` (Layer l) | `lnIn` = ln_1(x); `q`, `k`, `v` = Drittel von c_attn(lnIn), je `[n, D]` (Heads hintereinander); `weights` `[H, n, b]` = softmax(q·kᵀ/√d_head) mit kausaler Maske über alle Schlüssel `0..b−1` (Cache + neu); `out` = c_proj(Heads verkettet) `[n, D]` |
| `residual` (nach Attention) | `stream` = x + out |
| `mlp` (Layer l) | `lnIn` = ln_2(stream), `hidden` = gelu(c_fc(lnIn)) `[n, M]`, `out` = c_proj(hidden) `[n, D]` |
| `residual` (nach MLP) | `stream` = Strom + mlp.out |
| `logits` | ln_f auf der letzten Position, Logits = h · wteᵀ; die `topN` (Default 100) größten Logits, absteigend (Gleichstand: ID aufsteigend); `prob` = Softmax über das **ganze** Vokabular, auf die Top-N renormiert; `coverage` = deren Summe vor der Renormierung; `vocabSize` = V |

**KV-Cache:** Der Worker merkt sich je Layer K und V aller berechneten Positionen samt der
Token-IDs. Ist `context[0..a)` gleich den gemerkten IDs, rechnet `forward` nur `[a, b)`; sonst
verwirft er den Cache und rechnet ab Position 0 (ausgegeben werden trotzdem nur die Zeilen
`[a, b)`).

**Grenze:** Der Prompt darf höchstens `maxPromptTokens` (Default 64) Tokens haben, damit der Trace
handhabbar bleibt; sonst endet der Lauf mit „Der Prompt hat n Tokens; die GPT-2-Engine erlaubt
höchstens m.“ Das verschärft den Engine-Vertrag nicht: CON-0002 erlaubt jeder Engine, einen Lauf
mit einem `error`-Event zu beenden (wie die RemoteEngine bei Serverfehlern), und `load()` vor
`forward` gilt für alle Engines (`Loadable`).

### 3.6 Template Method vermeiden: gemeinsame Bausteine statt Vererbung

LayerNorm, Matrixprodukt, GELU und Softmax sind kleine reine Funktionen in `math.ts`; der KV-Cache
mit seiner Invalidierung steht in `kv-cache.ts`, der Forward-Pass mit den Stationen in `model.ts`
(je ein Änderungsgrund). Die
MockEngine (SPEC-0001) bleibt unverändert; eine gemeinsame Basisklasse beider Engines wird
bewusst nicht eingeführt (sie unterscheiden sich in Gewichtsquelle, Vokabular und Ausführungsort).

### 3.7 Factory Method (Creational)

`createEngine('gpt2', deps, { gpt2: { model, tokenizer, loadWeights } })` baut die Engine und den
Worker (`new Worker(new URL('../engine/gpt2/worker.ts', import.meta.url), { type: 'module' })`).
`info = { kind: 'gpt2', model: <Name aus dem Manifest>, capabilities: alle sieben, architecture:
aus der Konfiguration, eosTokenId: 50256 }`.

Quelle: https://refactoring.guru/design-patterns/factory-method

Die Factory bleibt bei Schlüssel + Optionsobjekt (wie `mock`/`remote`); eine Registry lohnt sich
bei drei Engines noch nicht (bewusste Abwägung, Open/Closed-Warnung im Review).

### 3.8 Oberfläche

- Gruppe „Engine“: dritte Option „GPT-2 (Browser)“. Bei Wahl erscheint die Auswahl „GPT-2-Modell“
  mit den Manifest-Einträgen; ohne Manifest oder ohne Einträge der Hinweis „Keine GPT-2-Gewichte
  gefunden. Mit „npm run fetch-model -- distilgpt2“ herunterladen.“
- Während des Ladens: Fortschrittstext aus `onProgress` und Knopf „Abbrechen“ (wie SPEC-0005);
  danach „Schritt i von n“.
- Fehler beim Laden: `alert` „Erzeugen fehlgeschlagen: <Meldung>“; Fehler im Lauf wie SPEC-0005.

### 3.9 Festlegungen für die test-first geschriebenen Tests

- **Fixture:** `tests/fixtures/gpt2/tiny-gpt2.safetensors` (2 Layer, 2 Heads, D = 8, V = 50257,
  C = 64; zufällige Gewichte, Seed 20261022, erzeugt mit `transformers`), `tiny-gpt2.config.json`,
  `tiny-gpt2.golden.json` (Referenzwerte aus `transformers`, eager-Attention, per Hooks
  aufgezeichnet), `f16-sample.safetensors`.
- **Module:** `@/engine/gpt2/safetensors` (`parseSafetensors`), `@/engine/gpt2/config`
  (`parseGpt2Config`), `@/engine/gpt2/weights` (`mapGpt2Weights`), `@/engine/gpt2/model`
  (`Gpt2Model`), `@/engine/gpt2/worker-handler` (`createGpt2WorkerHandler`),
  `@/engine/gpt2/gpt2-engine` (`Gpt2Engine`), `@/engine/gpt2/errors` (`Gpt2LoadError`),
  `@/engine/gpt2/math`, `@/engine/gpt2/kv-cache`; `@/app/gpt2/models` (`parseModelManifest`).
- **DOM:** `radio` „GPT-2 (Browser)“ in „Engine“, `combobox` „GPT-2-Modell“.

## 4. Funktionale Anforderungen

- **FR-01:** `parseSafetensors` liest safetensors nach 3.4 (F32/F16/BF16) und meldet ungültige Dateien als `Gpt2LoadError('format')`.
- **FR-02:** `parseGpt2Config` und `mapGpt2Weights` lesen Konfiguration und Gewichte nach 3.4 (Präfix optional, Puffer ignoriert, Formen geprüft).
- **FR-03:** `Gpt2Model` rechnet GPT-2 nach 3.5 und liefert die Stationen `embed`, je Layer `attention`, `residual`, `mlp`, `residual`, dann `logits`, numerisch gleich der Referenz.
- **FR-04:** KV-Cache nach 3.5; ein abweichender Kontext verwirft ihn.
- **FR-05:** Worker-Protokoll und `Gpt2Engine` (Proxy) nach 3.2: `load` mit Fortschritt und Abbruch, `forward` als AsyncIterable der Stationen, `dispose` beendet den Worker; Prompt-Grenze nach 3.5.
- **FR-06:** `createEngine('gpt2', …)` nach 3.7; ESLint-Zonen für `src/engine/gpt2`.
- **FR-07:** `src/app/gpt2/` lädt Manifest und Gewichte nach 3.3 (Fortschritt, Cache API, Fehler, Abbruch).
- **FR-08:** `scripts/fetch-model.mjs` und `npm run fetch-model`; `public/models/` ist gitignoriert.
- **FR-09:** Oberfläche nach 3.8; die App behält eine geladene Engine je Modell für weitere Läufe.
- **FR-10:** Alle neuen Texte in `src/app/texts.ts`; bestehende Contracts bleiben erfüllt; keine Anfragen an fremde Origins.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                     | um ...                                                        |
|-------|----------------|--------------------------------------------------------------------|---------------------------------------------------------------|
| US-01 | Lernende/r     | ein echtes GPT-2 im Browser laufen lassen und jede Station sehen   | zu sehen, was in einem Transformer wirklich passiert          |
| US-02 | Vortragende/r  | das Modell einmal laden und dann offline vorführen                 | im Hörsaal nicht vom Netz abzuhängen                          |
| US-03 | Entwickler     | sicher sein, dass die Zahlen stimmen                               | dass die Visualisierung keine falschen Interna zeigt          |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Korrektheit     | Abweichung zur Referenz ≤ 1e-4 (Aktivierungen), ≤ 1e-5 (Attention-Gewichte), ≤ 1e-3 (Logits) |
| Performance     | distilgpt2: Prompt mit 8 Tokens plus 8 Schritte < 30 s auf einem aktuellen Laptop (manuelle Abnahme); Testmodell: ein Schritt < 50 ms |
| Speicher        | Gewichte einmal im Worker (Transfer statt Kopie); F32-Tensoren als Sichten auf den Puffer |
| Bedienbarkeit   | Rechnung im Worker; Fortschritt beim Laden; Abbrechen jederzeit |
| Datenschutz     | Gewichte vom eigenen Origin; keine Anfragen an fremde Origins zur Laufzeit |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: GPT-2 im Browser

  Scenario: Lauf mit dem Testmodell
    Given das Manifest enthält das Testmodell
    When ich "GPT-2 (Browser)" wähle und "Die Katze sitzt" mit 3 Tokens erzeuge
    Then hat Schritt 0 zwölf Stationen und die Attention-Station zeigt "weights [2, 6, 6]"

  Scenario: Gewichte aus dem Cache
    Given ich habe schon einmal erzeugt
    When ich die Seite neu lade und erneut erzeuge
    Then wird model.safetensors nicht erneut angefragt
```

Die verbindlichen Szenarien stehen in den Contracts (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Prompt länger als `maxPromptTokens`: Lauf endet mit Meldung; länger als `n_positions`: Generator-Fehler (SPEC-0001).
- Abbruch während des Ladens: keine Meldung, kein Trace; Abbruch während eines Schritts: `aborted`.
- Abgeschnittene oder fremde Datei: `format`-Fehler mit Grund.
- Fehlende Cache API (unsicherer Kontext): Laden ohne Cache.
- Zwei Läufe mit verschiedenen Prompts nacheinander: Cache wird verworfen, Ergebnisse stimmen.
- Worker stürzt ab (z. B. Speicher): Lauf endet mit „Der GPT-2-Worker ist abgestürzt.“

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0014 | behavior (markdown) | safetensors, Konfiguration, Gewichte, Rechnung gegen Referenz, KV-Cache, Worker/Proxy, Factory, Schichtregel |
| CON-0015 | behavior (gherkin)  | Engine-Wahl GPT-2, Manifest, Laden mit Fortschritt und Cache, Fehler, Abbrechen, Lauf |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0015 | unit       | CON-0014 mit dem Testmodell und den Referenzwerten aus `transformers` |
| TST-0016 | acceptance | CON-0015 mit dem Testmodell, ausgeliefert per `page.route` |

## 11. Implementierungsreihenfolge

Genau zwei Tasks, je einer pro vorhandener (committeter) Testsuite. Fixtures unter `tests/fixtures/`
liegen bereits vor.

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | safetensors, Konfiguration, Gewichte, Modell, KV-Cache, Worker, Proxy, Factory, ESLint-Zone | FR-01–FR-06 | `tests/unit/gpt2-engine.test.ts` | `src/engine/gpt2/**`, `src/app/engine-factory.ts`, `eslint.config.js`, `vite.config.ts` |
| 2 | Manifest, Laden mit Cache, Skript, Oberfläche | FR-07–FR-10 | `tests/e2e/gpt2.spec.ts` | `src/app/**`, `src/views/**`, `scripts/**`, `package.json`, `.gitignore`, `public/models/.gitkeep` |

## 12. Offene Fragen

- [x] Gewichte vom eigenen Origin oder direkt von Hugging Face? **Antwort (2026-10-22, autonom entschieden):** eigener Origin über ein Download-Skript; die App lädt zur Laufzeit nichts von fremden Origins (SPEC-0002 NFR Datenschutz) und funktioniert danach offline.
- [x] Welches Modell zuerst? **Antwort (2026-10-22, autonom entschieden):** distilgpt2 als Empfehlung (halb so groß, 6 Layer, gut für Vorführungen); gpt2 funktioniert gleich.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review: math/kv-cache/model getrennt, Fortschritt als Daten, Loader-Kette mit injiziertem fetch/Cache, Command-Protokoll, Begründung Prompt-Grenze und Factory |
| 2026-10-22 | 0.2.1   | Boris  | Nachtrag aus SPEC-0008: affine Schichten und Vokabular-Projektion laufen über einen austauschbaren Rechenkern (JS als Referenz, WASM SIMD); CON-0014 v0.2.0, `ready` meldet den Kern |
