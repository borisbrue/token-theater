---
id: SPEC-0011
title: "Mixture-of-Experts routing made visible"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-23
updated: 2026-10-23
version: 0.2.3
priority: medium        # low | medium | high | critical
tags: [trace-format, moe, views, exporter, glossary]
depends_on: ["SPEC-0001", "SPEC-0007", "SPEC-0009", "SPEC-0010"]
contracts: ["CON-0001", "CON-0021", "CON-0022", "CON-0023"]
tests: ["TST-0023", "TST-0024", "TST-0025", "TST-0026"]
fr_test_map:
  FR-01: [TST-0024]
  FR-02: [TST-0024, TST-0026]
  FR-03: [TST-0026]
  FR-04: [TST-0026]
  FR-05: [TST-0023, TST-0026]
  FR-06: [TST-0023, TST-0026]
  FR-07: [TST-0025]
  FR-08: [TST-0025, TST-0026]
  FR-09: [TST-0026]
---

# Mixture-of-Experts routing made visible

> **Status:** draft · **Owner:** Boris · **Version:** 0.2.3
> Grundlage: `.sdd/docs/architecture/vision.md`, Frage von Boris nach SPEC-0010: „Können wir damit
> auch die einzelnen Layer eines MoE Modells sichtbar machen?“

## 1. Kontext & Motivation

Token Theater kennt nur dichte Layer nach GPT-2-Bauart: attention, residual, mlp, residual. Viele
aktuelle Modelle (Mixtral, Qwen-MoE, OLMoE, Granite-MoE, DeepSeek) ersetzen das MLP durch eine
*Mixture of Experts*: viele kleine MLPs („Experten“), von denen ein Router je Token nur wenige
(Top-k) rechnen lässt und deren Ergebnisse er nach Gate-Gewichten mischt. Gerade das Routing ist
das Neue und Anschauliche an diesen Modellen: welches Token in welchem Layer zu welchen Experten
geht, wie sicher der Router ist und ob sich Experten auf Muster spezialisieren.

Zwei Hürden:

- **Format:** Trace (CON-0001) und Stationen kennen kein Routing.
- **Daten:** Selbst kleine MoE-Modelle haben über eine Milliarde Parameter (mehrere GB). Eine
  MoE-Engine im Browser wäre ein eigenes Großprojekt; die Remote-Engine liefert nur Logprobs.

Diese Spec trennt beides: Das Format und die Ansicht kommen in die App; echte Daten liefert ein
Python-Exporter, der einen Trace mit `transformers` aufnimmt und über den vorhandenen Import
(SPEC-0001, SPEC-0009) in die App kommt. Eine Mock-MoE-Engine macht die Ansicht ohne Python und
ohne Download vorführbar.

## 2. Zielsetzung

### Erfolgskriterien

- Ein Trace eines echten MoE-Modells (Referenz: `ibm-granite/granite-3.1-1b-a400m-base`, 24 Layer,
  32 Experten, Top-8, Apache-2.0, 2,7 GB) lässt sich exportieren, ohne Befund importieren und
  Station für Station abspielen.
- Je MoE-Layer zeigt die Station `moe`, welche Experten jedes Token bekommt, mit welchem
  Gate-Gewicht und wie der Router alle Experten bewertet hat.
- Für ein gewähltes Token zeigt dieselbe Station seine Experten in **allen** Layern des Schritts.
- Die Layer-Karte bleibt bei 24 Layern in 1280 × 720 lesbar; die Bühne passt weiter ins Fenster.
- „Mock-MoE“ erzeugt im Browser deterministische MoE-Traces (2 Layer, 4 Experten, Top-2).
- Glossar und Erklärtexte erklären MoE, Experte, Router und Gate-Gewicht.
- Bestehende Traces bleiben gültig und sehen unverändert aus (`schemaVersion` bleibt 1).

### Nicht-Ziele

- Eine MoE-Engine im Browser (Gewichte laden, rechnen).
- Router-Daten über die Remote-Engine; OpenAI-kompatible Server liefern sie nicht.
- Gewichte oder Hidden-Zustände der einzelnen Experten anzeigen; die Station zeigt Routing,
  Eingang und gemischte Ausgabe.
- Shared Experts (Qwen-MoE, DeepSeek) getrennt darstellen; ihr Beitrag steckt in `out`.
- Load-Balancing-Loss, Kapazitätsgrenzen, Token-Dropping; nur Inferenz.
- Bewertung, ob ein Modell „gut“ routet; die App zeigt, sie urteilt nicht.

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

| Schicht | Neu oder geändert |
|---|---|
| `src/trace/` | Station `moe`, Architekturfelder `nExperts` und `topK`, `residual.after = 'moe'`, Schema, INV-05/06/08 erweitert, INV-18 |
| `src/engine/mock/` | Option `moe` der `MockEngine` |
| `src/playback/` | Verweildauer der Art `moe` |
| `src/app/` | Engine „Mock-MoE“ in der Gruppe „Engine“, Texte, Glossar, Begriffe je Station |
| `src/views/moe/` | `MoeView.tsx`, reine Funktionen in `routing.ts` |
| `src/views/station/` | Stationsname und Kurzlabel, Layer-Karte (Kurztext `X`, Verdichtung), Tensorliste, `lacksInternals` |
| `src/views/residual/` | `after: 'moe'` wie `'mlp'` (Verlauf, Logit-Lens) |
| `src/app/theme/moe.css` | Farben der Routing-Tabelle, nur `var(--tt-…)` |
| `scripts/moe-export/` | Python-Exporter als uv-Projekt (`pyproject.toml`, `uv.lock`; `.venv` gitignoriert) |
| `tests/fixtures/moe/` | kleiner Trace aus dem Exporter (Zufallsgewichte) |

`src/views` importiert weiter nichts aus `src/app` oder `src/engine` (CON-0004).

### 3.2 Station `moe` (CON-0001 v0.5.0)

```ts
export interface MoeStation {
  kind: 'moe';
  layer: number;
  /** Eingang nach der Norm, Form [n, D]. */
  lnIn: Tensor;
  /** Rohe Router-Bewertung je Token und Experte, Form [n, nExperts]. */
  routerLogits: Tensor;
  /** Je neue Position die gewählten Experten, absteigend nach Gate; Länge n, je Zeile topK. */
  experts: number[][];
  /** Gate-Gewichte passend zu experts. */
  gates: number[][];
  /** Gemischte Ausgabe, die zum Residual Stream addiert wird, Form [n, D]. */
  out: Tensor;
}
```

`Architecture` bekommt die optionalen Felder `nExperts` und `topK`; `dMlp` ist bei MoE die Breite
eines Experten. `ResidualStation.after` wird `'attention' | 'mlp' | 'moe'`. `StationKind` bekommt
`'moe'`; `STATION_KINDS` führt es nach `'mlp'`.

**Invarianten:**

- **INV-05** (erweitert): An der Stelle von `mlp(l)` steht `mlp(l)` oder `moe(l)`; die folgende
  residual-Station hat `after` gleich dieser Art. Ein Trace darf dichte und MoE-Layer mischen
  (DeepSeek: erster Layer dicht).
- **INV-06** (erweitert): Enthält `capabilities` die Art `moe`, ist `architecture` nicht `null`
  und hat `nExperts ≥ 2` und `1 ≤ topK ≤ nExperts`.
- **INV-08** (erweitert): `moe.lnIn|out` haben `[n, D]`, `moe.routerLogits` hat
  `[n, nExperts]`.
- **INV-18 Routing** (neu): Je Zeile `i < n`: `experts[i]` hat genau `topK` verschiedene IDs aus
  `0..nExperts−1`; `gates[i]` hat dieselbe Länge, jedes Gate liegt in `(0, 1]`, absteigend
  sortiert, Summe `≤ 1 + 1e-5`; die gewählten Experten sind die mit den höchsten
  `routerLogits[i]` (jeder gewählte Wert `≥` jedem nicht gewählten). Die Summe darf unter 1
  liegen (Modelle ohne Renormierung, z. B. Qwen2-MoE). Befunde haben einen `path` ab
  `/steps/<s>/stations/<i>/`.

Das Schema (`src/trace/trace.schema.json` und der Contract-Spiegel) beschreibt `MoeStation` als
neue Variante; `schemaVersion` bleibt 1 (wie INV-16, INV-17). Ein Trace ohne `moe` ist von allen
Änderungen nicht betroffen.

### 3.3 Mock-MoE

`MockEngineOptions.moe?: { nExperts: number; topK: number }`. Mit der Option liefert die
Mock-Engine `moe` statt `mlp` in jedem Layer, `residual` danach mit `after: 'moe'`, und meldet
`model: 'mock-de-52-moe'` sowie `architecture = { …MOCK_ARCHITECTURE, dMlp: 16, nExperts, topK }`
(16 = Breite eines Experten).

- Router (`[D, nExperts]`) und Experten (je `w1 [D, 16]`, `b1`, `w2 [16, D]`, `b2`, GELU) kommen
  aus einem **eigenen** Zufallsgenerator mit Seed `(weightSeed ^ 0x9e3779b9) >>> 0`. Die übrigen
  Gewichte bleiben dieselben; ohne Option `moe` ist jeder Trace bytegleich zu vorher.
- Top-k: die `topK` höchsten Router-Logits, bei Gleichstand die kleinere Experten-ID zuerst;
  `gates = softmax(routerLogits[top-k])`, absteigend; `out = Σ gate · expert(lnIn)`.
- Default-Fähigkeiten mit `moe`: wie ohne, aber `moe` statt `mlp`. `capabilities` mit `mlp` und
  Option `moe` oder mit `moe` ohne Option ist ein `RangeError`; `nExperts < 2`, `topK < 1` oder
  `topK > nExperts` ebenso.
- Die Logit-Lens hängt an `residual` nach `moe` wie sonst nach `mlp`. Die Gruppe „Engine“ bekommt die Wahl „Mock-MoE“
(`nExperts 4`, `topK 2`); sie entsteht in `engine-factory.ts` als `MockEngine` mit dieser Option
(Factory Method aus SPEC-0001 §3.7). „Mock“ bleibt unverändert.

### 3.4 Ansicht der Station `moe`

Die `moe`-Station hat oben die Positionswahl wie alle Ansichten aus SPEC-0007 (`PositionPicker`,
Gruppe „Position“, gemeinsame Auswahl des Players; Default die letzte Position) und darunter
drei Teile. Alle Werte stehen auch als Text bereit (Tastatur, Screenreader):

1. **Routing-Tabelle** (`table` mit `caption` „Routing“): eine Zeile je neue Position, Kopf der
   Zeile (`th scope=row`) „<Position> · <Token>“ wie in der Positionswahl, eine Spalte je
   Experte („E0“ … „E31“, `th scope=col`). Die Zellfarbe ist `softmax(routerLogits[i])[e]`.
   Gewählte Zellen haben die Klasse `chosen`, sind umrandet und zeigen das Gate in ganzen Prozent
   („42 %“); andere Zellen sind leer. `aria-label` einer Zelle: „Experte 5: Router 31 %, gewählt,
   Gate 42 %“ bzw. „Experte 6: Router 2 %“. Die Zeile der gewählten Position hat die Klasse
   `selected`.
2. **Gewählte Experten** (Liste, Beschriftung „Gewählte Experten“): für das gewählte Token die
   `topK` Experten in Gate-Reihenfolge, je Eintrag „Experte 5 · 42 %“ mit Balken; darunter
   „Summe der Gates: 100 %“ (ganze Prozent; bei Modellen ohne Renormierung der tatsächliche Wert).
3. **In allen Layern** (`table` mit `caption` „Experten dieses Tokens in allen Layern“): eine
   Zeile je Layer des Schritts mit `moe`-Station, Kopf „Layer 3“, Spalten = Experten; Zellen der
   gewählten Experten des gewählten Tokens haben die Klasse `chosen` und zeigen das Gate, die
   Zeile des aktuellen Layers hat die Klasse `current`. Ein dichter Layer eines gemischten Traces
   ist eine Zeile „Layer 0“ mit einer Zelle „dicht“ über alle Spalten.

Die reinen Funktionen in `src/views/moe/routing.ts` (`routerProbs`, `layerRoutes`) rechnen ohne
DOM und sind browserlos testbar. Bei mehr als 64 Experten scrollt die Tabelle waagerecht in ihrem
eigenen Container; die Seite scrollt nicht.

Die Tensorliste der Station (SPEC-0007) nennt `lnIn`, `routerLogits`, `out`.

### 3.5 Layer-Karte und angrenzende Stellen

- Kurztext der Art `moe` in der Layer-Karte: `X` (Experten). Ein MoE-Layer liest sich „A + X +“.
  In der Stationsleiste heißt die Station `X0`, `X1`, … (`R` ist dort schon residual).
- **Verdichtung** ab mehr als 8 Layern: Nur die Gruppe des aktuellen Layers zeigt ihre Kästchen,
  jede andere Layer-Gruppe ist ein einzelnes Kästchen „L7“ mit `aria-label` „Layer 7“. Die
  Gruppen Eingabe und Ausgabe bleiben unverändert. Bis 8 Layer (Mock, distilgpt2 mit 6) bleibt
  die Karte wie in SPEC-0010. Das Kästchen eines verdichteten Layers trägt die Klasse
  `layer-cell-collapsed` und den Text „L7“; die Zeile zum Teil im Layer zählt weiter die Stationen
  des Layers (Teil 3 von 4).
- **Hinweis ohne Interna** (SPEC-0009 §3.5): `lacksInternals` gilt, wenn `attention` oder
  `residual` fehlt oder sowohl `mlp` als auch `moe` fehlen. `embed` ist nicht mehr nötig: ein
  exportierter RoPE-Trace hat keine embed-Station, aber volle Interna. Traces aus SPEC-0009 (ohne
  alle vier Arten) zeigen den Hinweis weiter.
- **Residual-Ansicht** (SPEC-0007): Der Verlauf nennt eine Station nach MoE „Layer 3 · nach MoE“;
  eine `lens` nach MoE zeigt sie wie nach MLP. Die Hinweistexte der Ansicht bleiben unverändert.
- **Tensorliste:** `lnIn`, `routerLogits`, `out`. **Verweildauer** bei 1×: 1800 ms.

### 3.6 Texte

| Stelle | Text |
|---|---|
| Stationsname | `moe · Layer 3`; residual danach `residual · Layer 3 · nach MoE` |
| Erklärsatz | Statt eines einzigen [[mlp\|MLP]] hat dieser Layer viele [[expert\|Experten]]. Ein [[router\|Router]] wählt für jedes Token wenige davon aus und mischt ihre Ergebnisse nach [[gate\|Gate-Gewichten]]. |
| Mehr dazu (mit Zahlen) | Dieses Modell hat 32 Experten je MoE-Layer; je Token rechnen 8 davon. Jeder [[expert\|Experte]] ist ein eigenes kleines MLP. So hat das Modell viele Parameter, rechnet je Token aber nur mit einem Teil davon. |
| Mehr dazu (ohne Zahlen) | ohne den ersten Satz |
| Zeile zum Teil im Layer | [[layer\|Layer]] 3 · Teil 3 von 4: Der [[router\|Router]] schickt jedes Token an wenige [[expert\|Experten]]. |
| residual nach MoE: Zeile zum Teil | wie nach MLP: „Sein Ergebnis wird addiert; der Layer ist fertig.“ |
| residual nach MoE: Mehr dazu | Nach den [[expert\|Experten]] ist ein Layer fertig; der Strom geht an den nächsten Layer oder, nach dem letzten, an die Ausgabe. Die [[logitLens\|Logit-Lens]] zeigt, welches Token das Modell vorhersagen würde, wenn es hier aufhörte. — mit Zahlen wie nach MLP: „Das Modell hat 24 Layer, gezählt ab 0.“ |

Die Zahlen in „Mehr dazu“ kommen aus `architecture` (`nExperts`, `topK`; `ModelFacts` bekommt
beide als `number | null`); fehlt eine, gilt die Fassung ohne Zahlen. Alle bisherigen Texte bleiben Wort für Wort gleich (Abgleichtest
aus SPEC-0010).

### 3.7 Glossar

Vier neue Einträge, damit 37 (Texte verbindlich):

| TermId | term | meaning | inApp |
|---|---|---|---|
| moe | Mixture of Experts | Eine Bauart, bei der ein Layer statt eines MLP viele Experten hat und je Token nur wenige davon rechnen. Das Modell hat dadurch viele Parameter, braucht je Token aber nur einen Bruchteil der Rechenarbeit. | Die moe-Stationen; die Layer-Karte zeigt sie als „X“. |
| expert | Experte | Eines von vielen kleinen MLPs in einem MoE-Layer, jedes mit eigenen Gewichten. Experten spezialisieren sich beim Training oft auf Muster wie Satzzeichen, Zahlen oder Wortarten, selten auf ein ganzes Thema. | Die Spalten der Routing-Tabelle, gezählt ab 0. |
| router | Router | Eine kleine lineare Schicht, die für jedes Token eine Bewertung je Experte berechnet. Die Experten mit den höchsten Bewertungen bekommen das Token. | Die Farbe einer Zelle in der Routing-Tabelle zeigt, wie stark der Router diesen Experten bewertet. |
| gate | Gate-Gewicht | Der Anteil, mit dem das Ergebnis eines gewählten Experten in die Mischung eingeht. Meist ergeben die Gate-Gewichte eines Tokens zusammen 100 %. | Die Prozentzahl in den umrandeten Zellen und die Balken unter „Gewählte Experten“. |

Begriffe je Station: `moe` → `moe`, `router`, `expert`, `gate`, `layerNorm` („Mixture of Experts“,
„Router“, „Experte“, „Gate-Gewicht“, „LayerNorm“). Erster Begriff der Glossar-Ansicht bleibt „Attention“, letzter „Vokabular“.

### 3.8 Python-Exporter

`scripts/moe-export/export_trace.py` in einem uv-Projekt: Python-Tooling und Abhängigkeiten
laufen ausschließlich über **uv** (kein `pip`, kein `requirements.txt`, kein manuelles venv).

- `scripts/moe-export/pyproject.toml` mit `requires-python`, den Abhängigkeiten (torch,
  transformers, safetensors) und torch aus dem CPU-Index von PyTorch
  (`[[tool.uv.index]]` mit `explicit = true`, `[tool.uv.sources]`).
- `scripts/moe-export/uv.lock` wird eingecheckt; Python-Version in `.python-version`.
- uv legt `scripts/moe-export/.venv` selbst an (gitignoriert).
- Aufruf immer `uv run --project scripts/moe-export export_trace.py …`; Entwicklerwerkzeuge
  (ruff, pytest) als uv-Dependency-Group `dev`, Aufruf per `uv run`.
- `package.json` bekommt das Skript `export-moe` (`uv run --project scripts/moe-export
  scripts/moe-export/export_trace.py`), damit es neben `fetch-model` steht.

```
npm run export-moe -- --model ibm-granite/granite-3.1-1b-a400m-base \
  --prompt "Die Katze sitzt auf der" --max-tokens 8 \
  --strategy greedy|sample [--temperature 0.8 --seed 1] \
  [--top-n 50] [--lens-top-n 5] --out trace.json
npm run export-moe -- --tiny-random --seed 1 --out tests/fixtures/moe/tiny-granitemoe.trace.json
```

- Unterstützt mindestens `GraniteMoeForCausalLM` und `MixtralForCausalLM`; andere Architekturen
  brechen mit klarer Meldung ab.
- Nimmt den Lauf per Forward-Hooks auf: je Layer `lnIn`, `q`, `k`, `v`, Attention-Gewichte
  (`attn_implementation="eager"`), `out`, Router-Logits, gewählte Experten und Gates **so, wie
  das Modell sie benutzt hat**, MoE-Ausgabe, Residual Stream.
- `out` von Attention und MoE ist der Beitrag, der tatsächlich addiert wird (inkl. Faktoren wie
  Granites `residual_multiplier`). Bei Grouped-Query-Attention werden `k` und `v` auf alle Köpfe
  aufgefächert, damit `[n, D]` gilt.
- Keine `embed`-Station: Diese Modelle nutzen RoPE und haben keinen Positionsvektor; `embed` ist
  nicht in `capabilities`. Kein `bpe`.
- `logits`: Top-N (Default 50) mit `coverage`, `vocabSize` gesetzt; Logit-Lens auf den residual-
  Stationen nach MoE mit finaler Norm, `lm_head` und Granites `logits_scaling`.
- KV-Cache-Sicht wie CON-0001 INV-04: Schritt 0 alle Prompt-Positionen, danach je eine.
- `--tiny-random`: `GraniteMoeConfig` mit 2 Layern, `D 64`, 4 Köpfen (2 KV), 4 Experten, Top-2,
  Experten-Breite 32, Vokabular und Tokenizer von Granite; Zufallsgewichte aus `--seed`; Prompt
  „die katze sitzt“, 3 Tokens greedy. Das Ergebnis ist das Fixture.
- Der Exporter prüft vor dem Schreiben: gewählte Experten = Top-k der Router-Logits, Summe der
  letzten Logits gleich dem Modellausgang (`atol 1e-4`). Er schreibt nie Netzwerkdaten außer dem
  Download von Hugging Face.

### 3.9 Größe

Ein 24-Layer-Trace hat in Schritt 0 bei 8 Prompt-Tokens rund 2 Mio. Zahlen (≈ 11 MB als Base64),
danach je Schritt etwa 1/8 davon. Der Import muss 60 MB verkraften; größere Exporte sind Sache
des Nutzers (`--max-tokens`).

### 3.10 Patterns

- **Factory Method** (fortgeführt, SPEC-0001 §3.7): „Mock-MoE“ entsteht in `engine-factory.ts`,
  die Views sehen nur den Trace. https://refactoring.guru/design-patterns/factory-method
- **Strategy** (neu): Der Exporter kapselt die Modellfamilie in einem Adapter je Architektur
  (`GraniteMoeAdapter`, `MixtralAdapter`) mit gleicher Schnittstelle (Hooks setzen, Gates lesen,
  Residual-Faktoren). Abgelehnt: eine Fallunterscheidung im Aufnahmecode, die mit jeder Familie
  wächst. https://refactoring.guru/design-patterns/strategy
- **Mediator** (wiederverwendet, SPEC-0007 §3.8): Der Player hält die Positionswahl; die drei
  Teile der MoE-Ansicht lesen nur. https://refactoring.guru/design-patterns/mediator
- **Visitor** (funktionale Variante): Jede Operation über Stationsarten ist eine erschöpfende
  `Record<StationKind, …>`-Tabelle oder ein Switch mit `never`-Prüfung; `moe` kann so an keiner
  Stelle fehlen. https://refactoring.guru/design-patterns/visitor

**SOLID-Hinweise aus dem Review (bewusst so):**
- *S:* Mock-MoE bleibt in `MockEngine`, weil MoE nur den Feed-Forward-Block ersetzt und die
  Bytegleichheit ohne Option sonst schwerer zu sichern wäre; der MoE-Teil liegt in eigenen
  Funktionen (`createMoeWeights`, `routeMoe`) mit eigenem Generator.
- *O:* Eine neue Art berührt viele Tabellen; der Visitor macht das zum Typfehler statt zum
  stillen Fehler. Eine gemeinsame Eigenschaft „Feed-Forward-Art“ (`mlp | moe`) steht als Typ
  `FeedForwardKind` in `src/trace/types.ts` und wird von INV-05, `lacksInternals` und der
  Residual-Ansicht benutzt.
- *L:* `dMlp` ist bei MoE die Breite eines Experten; die einzigen Leser sind „Mehr dazu“ der
  mlp-Station (bei MoE nicht angezeigt) und INV-08 für `mlp.hidden` (bei MoE ohne Station).
- *I:* `nExperts`/`topK` sind optional in `Architecture`, weil sie zum Modell gehören;
  `ModelFacts` führt sie als `number | null`.

### 3.11 Festlegungen für die test-first geschriebenen Tests

- Unit (`tests/unit/moe-trace.test.ts`): Schema und INV-18 mit Hand-Traces (je Regel ein
  Verstoß), INV-05 mit gemischtem Trace, Mock-MoE deterministisch und befundfrei.
- Unit (`tests/unit/moe-fixture.test.ts`): Das Fixture besteht die Import-Kette ohne Befund,
  hat `capabilities` ohne `embed`, 2 Layer, `nExperts 4`, `topK 2`, und es bleibt nach Re-Export
  JSON-tief gleich.
- E2E (`tests/e2e/moe.spec.ts`): Mock-MoE-Lauf wie „Mock-Lauf“ in CON-0020 mit Engine
  „Mock-MoE“; Import des Fixtures; ein im Test erzeugter 24-Layer-MoE-Trace (Hilfsmodul
  `tests/e2e/moe-trace-helpers.ts`, auch von der Unit-Suite genutzt) für Verdichtung und Bühne.
- Unit (`tests/unit/moe-trace.test.ts`) prüft zusätzlich, dass der Mock ohne `moe` bytegleich
  bleibt: SHA-256 gegen `tests/fixtures/moe/mock-dense-before-spec-0011.json` (vor SPEC-0011
  erzeugt).
- `tests/e2e/glossary.spec.ts` liest zusätzlich die Tabelle §3.7 dieser Spec; 33 wird 37
  (CON-0021 v0.2.0). Der Textabgleich prüft die Arten aus SPEC-0010 gegen die Referenz und `moe`
  gegen §3.6. Die Anpassung geschieht test-first vor dem Run; ebenso
  `tests/unit/gpt2-engine.test.ts`, das als GPT-2-Fähigkeiten alle Arten außer `moe` erwartet.

## 4. Funktionale Anforderungen

| ID | Anforderung |
|---|---|
| FR-01 | Trace-Format: Station `moe`, `nExperts`/`topK`, `after: 'moe'`, INV-05/06/08 erweitert, INV-18 (§3.2). Bestehende Traces bleiben gültig und bytegleich. |
| FR-02 | Mock-MoE: Option `moe` der Mock-Engine und Wahl „Mock-MoE“ in der Gruppe „Engine“ (§3.3). |
| FR-03 | Ansicht der `moe`-Station mit Routing-Tabelle, gewählten Experten und „In allen Layern“ (§3.4). |
| FR-04 | Layer-Karte (Kurztext `X`, Verdichtung ab mehr als 8 Layern), Stationsleiste, Hinweis ohne Interna, Residual-Ansicht (§3.5). |
| FR-05 | Texte: Stationsname, Erklärsatz, „Mehr dazu“ mit und ohne Zahlen, Zeile zum Teil im Layer (§3.6). |
| FR-06 | Glossar: vier neue Einträge, Begriffe je Station `moe` (§3.7). |
| FR-07 | Python-Exporter für Granite-MoE und Mixtral mit `--tiny-random` (§3.8). |
| FR-08 | Fixture aus dem Exporter, importierbar ohne Befund, abspielbar in der App. |
| FR-09 | Präsentationsmodus: Bühne mit 24-Layer-MoE-Trace passt in 1280 × 720. |

## 5. User Stories

- Als Lernende/r sehe ich, wie ein MoE-Modell jedes Token an wenige Experten verteilt, und
  verstehe, warum es viele Parameter hat, aber wenig rechnet.
- Als Vortragende/r führe ich ohne Download mit „Mock-MoE“ vor, was ein Router tut, und zeige
  danach einen echten Granite-Trace.
- Als Neugierige/r verfolge ich ein Token durch alle 24 Layer und sehe, ob es immer zu
  denselben Experten geht.

## 6. Nicht-funktionale Anforderungen

- Import eines 60-MB-Traces in unter 10 s auf dem Entwicklungsrechner; Wechsel zwischen
  `moe`-Stationen ohne spürbare Verzögerung (< 100 ms je Render).
- Farben nur in `src/app/theme`; Kontrast der Gate-Prozente nach Aurora-Regeln (CON-0007).
- Der Exporter läuft auf CPU mit 16 GB RAM; Granite 1B-A400M braucht für 8 Prompt- und 8 neue
  Tokens höchstens einige Minuten.
- Keine Netzwerkzugriffe der App außer dem eigenen Origin (unverändert).

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Szenario: Mock-MoE zeigt das Routing
  Angenommen ein Lauf mit Engine "Mock-MoE"
  Wenn ich die Station "moe · Layer 0" wähle
  Dann hat die Tabelle "Routing" eine Zeile je Token und die Spalten "E0" bis "E3"
  Und sind in jeder Zeile genau 2 Zellen als gewählt markiert
  Und lautet die Zeile ".layer-part" "Layer 0 · Teil 3 von 4: Der Router schickt jedes Token an wenige Experten."

Szenario: Token durch alle Layer verfolgen
  Angenommen ein Lauf mit Engine "Mock-MoE"
  Wenn ich die Station "moe · Layer 1" wähle und die Position "1 · katze" wähle
  Dann zeigt "Experten dieses Tokens in allen Layern" die Zeilen "Layer 0" und "Layer 1"
  Und ist die Zeile "Layer 1" hervorgehoben

Szenario: Verdichtete Layer-Karte
  Angenommen ein importierter MoE-Trace mit 24 Layern
  Wenn ich die Station "moe · Layer 7" wähle
  Dann zeigt nur die Gruppe "Layer 7" ihre Kästchen "A", "+", "X" und "+"
  Und sind die übrigen 23 Layer je ein Kästchen

Szenario: Ungültiges Routing wird abgelehnt
  Angenommen ein Trace, in dem ein gewählter Experte eine niedrigere Router-Bewertung hat als ein nicht gewählter
  Wenn ich ihn importiere
  Dann meldet der Import einen Befund mit invariant "INV-18"
```

## 8. Edge Cases & Fehlerfälle

- `topK = nExperts`: jede Zelle gewählt; erlaubt.
- Gleichstand der Router-Logits an der Grenze: jede Wahl unter den Gleichen ist gültig (INV-18
  verlangt `≥`).
- Gemischter Trace (Layer 0 dicht, sonst MoE): Karte zeigt „A + M +“ und „A + X +“, „In allen
  Layern“ führt Layer 0 als „dicht“.
- Trace ohne `moe` in den Fähigkeiten, aber mit `nExperts`: gültig, nichts MoE-Spezifisches wird
  angezeigt.
- Exporter mit nicht unterstütztem Modell: Abbruch mit Meldung, keine Datei.
- Exporter ohne Netz und ohne Cache: Abbruch mit Meldung von `transformers`.
- Token-Texte mit unvollständigen UTF-8-Bytes (Byte-BPE): Exporter schreibt den dekodierten Text
  mit „�“, die ID bleibt maßgeblich.

## 9. Contracts (was wird garantiert)

| Contract | Typ | Inhalt |
|---|---|---|
| CON-0001 v0.5.0 | data (JSON Schema) | Station `moe`, `nExperts`/`topK`, `after: 'moe'`, INV-05/06/08 erweitert, INV-18 |
| CON-0022 | behavior (gherkin) | MoE-Ansicht, Layer-Karte mit `X` und Verdichtung, Texte, Import, Bühne mit 24 Layern |
| CON-0023 | behavior (markdown) | Mock-MoE (MS-01–MS-09) und Python-Exporter mit Fixture (EX-01–EX-08) |
| CON-0021 v0.2.0 | behavior (gherkin) | 37 statt 33 Begriffe |

## 10. Tests (wie wird verifiziert)

| Test-ID | Level | Was prüft der Test? |
|---|---|---|
| TST-0024 | unit | CON-0001 v0.5.0 für MoE, CON-0023 MS-01–MS-09 |
| TST-0025 | unit | CON-0023 EX-01–EX-08, ohne Python |
| TST-0026 | acceptance | CON-0022, alle Szenarien |
| TST-0023 | acceptance | CON-0021 v0.2.0 (37 Begriffe, Texte der Station `moe`) |

## 11. Implementierungsreihenfolge

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Trace-Format und Mock-MoE | FR-01, FR-02 (Engine) | `tests/unit/moe-trace.test.ts` | `src/**` (Format und Mock; in `src/app` und `src/views` nur die `moe`-Einträge, die `tsc` für die neue Art verlangt) |
| 2 | Python-Exporter und Fixture | FR-07, FR-08 | `tests/unit/moe-fixture.test.ts` | `scripts/moe-export/**`, `tests/fixtures/moe/**`, `.gitignore`, `package.json`, `eslint.config.js` |
| 3 | Ansicht, Karte, Texte, Glossar, Engine-Wahl | FR-02 (UI), FR-03–FR-06, FR-09 | `tests/e2e/moe.spec.ts` | `src/app/**`, `src/views/**` |

Das GREEN-Gate verlangt alle Tests grün: `moe-fixture.test.ts` bleibt bis zum Test-Schritt von
Task 2, `moe.spec.ts` und die angepasste `glossary.spec.ts` bleiben bis zum Test-Schritt von Task 3
aus dem Arbeitsbaum. Task 1 muss typvollständig sein: Die E2E-Suite baut mit `CI=1` per
`npm run build` (inkl. `tsc`), und eine neue Art in `StationKind` verlangt Einträge in allen
`Record<StationKind, …>` (Visitor, §3.10). Diese Einträge (Kurztexte, Tensorfelder, Verweildauer,
Stationsname, Erklärsatz, Begriffe, `never`-Fälle) kommen deshalb schon in Task 1; Task 3 baut
darauf Ansicht, Karte, Texte und Glossar. `eslint.config.js` nimmt die venv des Exporters aus.

## 12. Offene Fragen

- [x] Eine Station `moe` oder zwei (`router`, `experts`)? **Antwort (2026-10-23, autonom
  entschieden):** eine. Der Layer behält vier Teile wie in SPEC-0010; Router und Mischung sind
  ein Rechenschritt, und eine Station ohne eigene Ausgabe hätte nichts zum Residual Stream
  beizutragen.
- [x] Referenzmodell für den Exporter? **Antwort (2026-10-23, autonom entschieden):** Granite
  3.1 1B-A400M: klein genug für CPU und Platte (2,7 GB), Apache-2.0, 32 Experten Top-8. OLMoE
  (28 GB) und Qwen-MoE sind für diesen Rechner zu groß; Mixtral nur über `--tiny-random`-artige
  Konfigurationen testbar.
- [x] `embed` beim Export? **Antwort (2026-10-23, autonom entschieden):** nein, RoPE-Modelle haben
  keinen Positionsvektor; ein Nullvektor würde in die Irre führen.
- [ ] Soll der Exporter später auch dichte Modelle (Llama, Qwen) können? Nicht in dieser Spec.

## 13. Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Entwurf |
| 2026-10-23 | 0.1.1 | Python-Tooling über uv (Wunsch von Boris) |
| 2026-10-23 | 0.2.3 | Implementiert (Run SPEC-0011-20261023T141122-706997). Live-Probe mit Granite 3.1 1B-A400M: Export 5 min inkl. Download, Trace 18,5 MB, Import 3,4 s, Bühne 720/720 px; S3-Reopen für schmalere Tabellenzellen (32 Experten bei 1280 px) |
| 2026-10-23 | 0.2.2 | Task 1 mit `src/**`: der E2E-Build prüft `tsc`, Typ-Nachzüge gehören in Task 1 |
| 2026-10-23 | 0.2.1 | Task-Pfade nach Probe-Umsetzung: Task 1 ohne `src/app`/`src/views` außer der Engine-Fabrik, Task 2 mit `eslint.config.js` |
| 2026-10-23 | 0.2.0 | Review-Vorbereitung: Kurztext `X`, Positionswahl, Mock-Seeds, Hinweis ohne Interna, Residual-Ansicht, Task-Pfade |
