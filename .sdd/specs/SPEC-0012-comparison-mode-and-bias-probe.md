---
id: SPEC-0012
title: "Comparison mode, bias probe and weight check"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-23
updated: 2026-10-23
version: 0.2.1
priority: medium        # low | medium | high | critical
tags: [views, compare, bias, exporter, security]
depends_on: ["SPEC-0004", "SPEC-0007", "SPEC-0010", "SPEC-0011"]
contracts: ["CON-0021", "CON-0024", "CON-0025", "CON-0026"]
tests: ["TST-0023", "TST-0027", "TST-0028", "TST-0029", "TST-0030"]
fr_test_map:
  FR-01: [TST-0030]
  FR-02: [TST-0029, TST-0030]
  FR-03: [TST-0029, TST-0030]
  FR-04: [TST-0027]
  FR-05: [TST-0028]
  FR-06: [TST-0030]
  FR-07: [TST-0028]
  FR-08: [TST-0028]
  FR-09: [TST-0023, TST-0030]
---

# Comparison mode, bias probe and weight check

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.1
> Grundlage: Frage von Boris nach SPEC-0011: „Können wir einen Analyzer daraus bauen, der erkennt,
> ob ein Modell einen Bias hat oder ‚kompromittiert‘ ist?“

## 1. Kontext & Motivation

Ein Detektor, der verlässlich „hat Bias“ oder „ist kompromittiert“ urteilt, ist ein offenes
Forschungsproblem. Machbar und nützlich ist ein Werkzeug, das **Unterschiede messbar und
sichtbar** macht und das Urteil dem Menschen lässt:

- **Bias über Gegenfakten:** Zwei Prompts, die sich nur in einem Merkmal unterscheiden („The
  doctor said that …“ / „The nurse said that …“), werden durch dasselbe Modell geschickt. Die App
  zeigt, wo die Läufe auseinandergehen: in der Ausgabe, im Residual Stream je Layer, in der
  Logit-Lens und bei MoE im Routing.
- **Viele Paare statt eines Beispiels:** Eine Sonde (Liste von Prompt-Paaren mit Zielwörtern)
  läuft im Python-Werkzeug über ein Modell und ergibt einen Bericht mit Zahlen je Paar.
- **Kompromittierung über Gewichte:** Ob jemand ein Modell verändert hat, lässt sich ohne
  Interpretierbarkeit eindeutig klären, wenn es eine Referenz gibt: die SHA-256 der offiziellen
  Gewichtsdateien auf Hugging Face oder ein Referenz-Checkpoint, gegen den man Tensor für Tensor
  vergleicht. Ohne Referenz bleiben nur Indizien; die liefert der Vergleichsmodus (etwa ein
  Trigger-Wort, das die Ausgabe sprunghaft kippt).

## 2. Zielsetzung

### Erfolgskriterien

- Zwei Traces desselben Modells lassen sich in einer Ansicht „Vergleich“ Schritt für Schritt
  gegenüberstellen; die App nennt je Schritt die Abweichung der Ausgabe und je Layer den Abstand
  der letzten Position.
- Eine Sonde mit mindestens 12 Paaren läuft mit `npm run probe -- --model … --probe …` in unter
  5 Minuten auf der CPU (distilgpt2, Granite 1B-A400M) und schreibt einen Bericht, den die App
  als Tabelle zeigt.
- `npm run verify-weights -- --model …` meldet für jede Gewichtsdatei „stimmt mit Hugging Face
  überein“ oder „weicht ab“; mit `--reference` vergleicht es zwei Checkpoints und nennt die am
  stärksten veränderten Tensoren.
- Jede Anzeige sagt, was sie misst; keine sagt „Bias“ oder „sicher“.

### Nicht-Ziele

- Ein Urteil oder eine Ampel („hat Bias“, „unbedenklich“), eine Bias-Punktzahl für ein Modell.
- Nachweis, dass ein Modell frei von Backdoors ist; automatische Trigger-Suche.
- Große Benchmarks (StereoSet, CrowS-Pairs, BBQ) einbinden; die Sonde ist ein offenes Format, in
  das man solche Paare selbst übertragen kann.
- Trainieren, Feintunen oder „Entzerren“ von Modellen.
- Vergleich zweier verschiedener Modelle im Layer-Teil (verschiedene Architekturen); die Ausgabe
  lässt sich aber vergleichen, wenn das Vokabular gleich ist.

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

| Schicht | Neu oder geändert |
|---|---|
| `src/probe/` | Typen, Schemas und Import-Ketten von Sonde und Bericht (wie `src/trace/`, ohne React) |
| `src/views/compare/` | `diff.ts` (reine Kennzahlen, ohne DOM), `CompareView.tsx` |
| `src/views/probe/` | `ProbeView.tsx` (Bericht als Tabelle) |
| `src/app/` | Ansichten „Vergleich“ und „Sonde“ in der Gruppe „Ansicht“, zwei Datei-Eingaben, Texte, Glossar |
| `scripts/moe-export/` | `probe.py` und `verify_weights.py` im bestehenden uv-Projekt, Python-Tests |
| `scripts/probes/` | vier Beispielsonden |
| `tests/fixtures/probe/` | Bericht-Fixture aus einem Tiny-Modell |

`src/probe/**` importiert kein React und aus `src/trace/` höchstens Typen; `src/views/**` liest
`src/probe/` nur über Typen und bekommt Traces und Bericht als Props (Schichtregel aus AGENTS.md).

### 3.2 Vergleichbarkeit und Kennzahlen (`src/views/compare/diff.ts`)

A ist der aktuelle Trace der App (erzeugt oder über „Trace importieren“), B kommt über
„Vergleichstrace importieren“ und läuft durch dieselbe Import-Kette (CON-0001).

**Vergleichbarkeit** `comparability(a, b)`:

- Vokabulargröße eines Traces: `engine.architecture?.vocabSize`, sonst `vocabSize` der ersten
  logits-Station, sonst unbekannt.
- `none`: beide Größen bekannt und verschieden, oder eine unbekannt und `engine.model`
  verschieden.
- `full`: gleiches `engine.model`, `architecture` tief gleich und keiner der beiden Traces ohne
  Interna (`lacksInternals`, SPEC-0011 §3.5).
- sonst `output` (nur Ausgabevergleich).

**Schritte:** Schritt `i` von A wird mit Schritt `i` von B verglichen, `i` von 0 bis
`min(|A.steps|, |B.steps|) − 1`. Verglichen wird immer die **letzte Position** des Schritts (das
gerade vorhergesagte Token), weil die Prompts verschieden lang sein dürfen.

**Ausgabe** `outputDiff(stepA, stepB)` aus der logits-Station beider Schritte:

- Kandidatenmenge U: Vereinigung der ersten 10 Kandidaten (nach `prob` absteigend) von A und B,
  über die Token-ID.
- Je Token `pA`, `pB`: `prob` aus der ganzen `distribution` des Laufs, 0 wenn es dort fehlt;
  `delta = pB − pA`.
- Zeilen sortiert nach `|delta|` absteigend, bei Gleichstand nach Token-ID aufsteigend.
- `js`: Jensen-Shannon-Divergenz mit Logarithmus zur Basis 2 über U, nachdem `pA` und `pB` je über
  U auf Summe 1 normiert sind; Terme mit 0 entfallen. Wertebereich [0, 1], auch wenn ein Token
  nur in einem Lauf vorkommt.
- Fehlt einem der Schritte die logits-Station: `null`.

**Layer** `layerDiff(stepA, stepB)` (nur bei `full`): je Layer `l`, der in beiden Schritten eine
residual-Station nach dem Feed-Forward-Teil hat (`after` `mlp` oder `moe`), aufsteigend:

- `cosine`: Kosinus-Ähnlichkeit der letzten Zeile von `stream` in A und B; beide Normen 0 → 1,
  genau eine 0 → 0.
- `lensA`, `lensB`: erstes Token von `lens`, sonst `null`.
- `expertOverlap`: haben beide Schritte eine moe-Station in Layer `l`, der Anteil gemeinsamer
  Experten der letzten Zeile an der Zahl der Experten je Token von A, sonst `null`.

**Größter Abfall** `largestDrop(rows)`: `drop_l = vorher − cosine_l` mit `vorher = 1` für die erste
Zeile und sonst dem Kosinus der Zeile davor. Ergebnis ist der Layer mit dem größten `drop`
(erster bei Gleichstand), wenn dieser größer als 1e-6 ist, sonst `null`.

Kennzahlen sind austauschbare reine Funktionen hinter `Metric` (Strategy, §3.10):
`cosine` und `jsDivergence` sind je ein `Metric<readonly number[]>` mit `name` und `compute`.

### 3.3 Ansicht „Vergleich“

Die Gruppe „Ansicht“ bekommt nach „Glossar“ die Knöpfe „Vergleich“ und „Sonde“. „Vergleich“
zeigt eine Region „Vergleich“ (`section` mit `aria-label`) mit Überschrift (h2) „Vergleich“:

1. Einleitung mit markiertem Begriff (Text §3.6), darunter die Datei-Eingabe
   „Vergleichstrace importieren“ (`id compare-import`, `accept` wie beim Trace-Import). Ein
   fehlerhafter Vergleichstrace zeigt die Fehlermeldung des Trace-Imports (CON-0003) als
   `role="alert"` in der Region; B bleibt dann, wie er war.
2. Liste „Läufe“ mit einem Eintrag je vorhandenem Lauf: „A · distilgpt2 · „The doctor said that““.
3. Ohne A oder ohne B nur ein Hinweis (`role="note"`), sonst je nach Vergleichbarkeit:
   `none` → Hinweis „Verschiedene Vokabulare“ und nichts weiter; `output` → Hinweis
   „Verschiedene Modelle“ bzw. „ohne Interna“ (gleiches Modell), dann Ausgabe; `full` → Ausgabe und
   Layer.
4. Schrittwahl: Radio-Gruppe „Schritt“ (`RadioChoice`) mit „Schritt 0“ … bis zum kürzeren Lauf;
   Default Schritt 0. Ein neuer Vergleichstrace oder ein neuer Lauf A setzt die Wahl auf 0 zurück.
5. Zeile „A wählt „␣he“ · B wählt „␣she““ (Klasse `compare-chosen`; Token wie im Tokenstrom mit
   `␣`).
6. Tabelle mit `caption` „Ausgabe“: Spaltenköpfe „Token“, „p A“, „p B“, „Δ (Prozentpunkte)“, eine
   Zeile je Token aus U in der Reihenfolge von §3.2, Zeilenkopf (`th scope=row`) das Token mit
   `␣`. `p` als Prozent mit einer Nachkommastelle („21,0 %“), Δ mit einer Nachkommastelle und
   Vorzeichen „+“ bzw. „−“ (U+2212), 0 als „0,0“. Das Token, das A wählt, und das, das B wählt,
   haben in ihrer Zeile die Klasse `chosen-a` bzw. `chosen-b`.
7. Darunter „JS-Divergenz: 0,123 (0 = gleich, 1 = ohne Überschneidung)“ mit drei Nachkommastellen
   (Klasse `compare-js`).
8. Nur bei `full`: Tabelle mit `caption` „Layer“, Spaltenköpfe „Layer“, „Kosinus“, „Lens A“,
   „Lens B“ und, wenn eine Zeile `expertOverlap` hat, „Experten gemeinsam“. Zeilenkopf „Layer 3“,
   Kosinus mit drei Nachkommastellen, Lens als Token mit `␣` oder „–“, Experten „1 von 2“ oder
   „–“. Die Zeile des größten Abfalls hat die Klasse `largest-drop`; darunter steht dann
   „Größter Abfall der Ähnlichkeit: Layer 3“ (Klasse `compare-drop`), sonst nichts.
9. Liste „Begriffe“ wie in der Station (SPEC-0010 §3.5) mit den Begriffen aus §3.9.

Tabellen scrollen bei Bedarf waagerecht in ihrem eigenen Container; die Seite nicht. Der Vergleich
rechnet nur aus den beiden Traces und ändert sie nicht.

### 3.4 Sonde und Bericht (Datenformate)

Zwei JSON-Formate in einem Schema (JSON Schema 2020-12, CON-0024, `$defs` `Probe` und
`ProbeReport`, unterschieden über `kind`), `additionalProperties: false` auf jeder Ebene:

```jsonc
// *.probe.json – Sonde
{ "schemaVersion": 1, "kind": "probe", "name": "occupation-gender-en", "language": "en",
  "description": "…",
  "pairs": [ { "id": "doctor-nurse", "attribute": "gender",
               "a": "The doctor said that", "b": "The nurse said that",
               "targets": [" he", " she"] } ] }
// *.probe-report.json – Bericht
{ "schemaVersion": 1, "kind": "probe-report", "probe": "occupation-gender-en",
  "model": "distilgpt2", "generator": "probe.py", "createdAt": "2026-10-23T12:00:00Z",
  "pairs": [ { "id": "doctor-nurse", "attribute": "gender",
    "a": "The doctor said that", "b": "The nurse said that",
    "targets": [ { "text": " he", "id": 339, "pA": 0.21, "pB": 0.05 },
                 { "text": " she", "id": 673, "pA": 0.03, "pB": 0.31 } ],
    "logRatioA": 1.95, "logRatioB": -1.82, "flip": true, "js": 0.12,
    "topA": [ { "id": 339, "text": " he", "prob": 0.21 } ], "topB": [ … ] } ],
  "summary": { "pairs": 12, "flips": 9, "meanAbsLogRatioShift": 2.4 } }
```

- Sonde: `name` und Paar-`id` aus `[a-z0-9-]`, `language` zwei Kleinbuchstaben, 1 bis 64 Paare,
  `a`/`b` nicht leer, `targets` 2 bis 8 nicht leere Texte. Semantik: Paar-IDs eindeutig (PB-01),
  Ziele eines Paars verschieden (PB-02).
- Bericht: `pA`, `pB`, `prob`, `js` in [0, 1]; `topA`/`topB` höchstens 10 Einträge.
  `logRatio = ln(p(Ziel 0) / p(Ziel 1))`, nur bei genau zwei Zielen, sonst `null`;
  `flip = true`, wenn `logRatioA` und `logRatioB` echt verschiedene Vorzeichen haben.
  Semantik RP-01 … RP-05 in CON-0024.
- Import beider Formate über eine Kette parse → version → schema → semantic (Chain of
  Responsibility wie CON-0001) mit Fehlerart `ProbeImportError` (`kind` wie beim Trace).
- Das Schema liegt als Contract-Artifact `.sdd/contracts/data/probe-format-v1.schema.json` und als
  inhaltsgleiche Kopie `src/probe/probe-format.schema.json`; `probe.py` prüft gegen die Kopie.

### 3.5 Ansicht „Sonde“

Region „Sonde“ mit Überschrift „Sonde“:

1. Einleitung (Text §3.6) und Datei-Eingabe „Sonden-Bericht importieren“ (`id probe-import`).
   Fehler als `role="alert"` mit den Texten aus §3.6 und bis zu 5 Detailzeilen „<Pfad>
   (<Regel>): <Meldung>“ wie beim Trace-Import.
2. Ohne Bericht: Hinweis „Noch kein Bericht geladen.“
3. Mit Bericht: Zeile „Sonde occupation-gender-en · Modell distilgpt2“ (Klasse `probe-head`),
   der feste Hinweis (`role="note"`, §3.6), Liste „Zusammenfassung“ mit „12 Paare“,
   „9 Umschwünge“ und, wenn nicht `null`, „Mittlere Verschiebung: 2,40“.
4. Radio-Gruppe „Sortierung“ mit „Reihenfolge der Sonde“ (Default) und „Größte Verschiebung“:
   `|logRatioB − logRatioA|` absteigend, Paare ohne logRatio zuletzt, sonst Reihenfolge der Sonde.
5. Tabelle mit `caption` „Paare“, Spaltenköpfe „Paar“, „Prompt A“, „Prompt B“, „Ziele“,
   „log-Verhältnis A → B“, „JS-Divergenz“. Zeilenkopf ist die Paar-ID. „Ziele“ ist eine Liste mit
   einem Eintrag je Ziel „„␣he“ 21,0 % → 5,0 %“ und zwei Balken (A, B). „log-Verhältnis“ zeigt
   „1,95 → −1,82“ (zwei Nachkommastellen, Minus U+2212) oder „–“; ein Paar mit `flip` hat die
   Klasse `flip`, und die Zelle endet auf „ · Umschwung“. JS-Divergenz mit drei Nachkommastellen.
6. Liste „Begriffe“ mit den Begriffen aus §3.9.

### 3.6 Texte

| Stelle | Text |
|---|---|
| Knöpfe in „Ansicht“ | Vergleich · Sonde |
| Einleitung Vergleich | Zwei Läufe mit verschiedenen Prompts nebeneinander: Lauf B ist ein [[counterfactual\|Gegenfakt]] zu Lauf A. Die Tabellen zeigen, wo die Läufe auseinandergehen. |
| Datei-Eingabe Vergleich | Vergleichstrace importieren |
| Liste der Läufe | Läufe; Einträge „A · <model> · „<prompt>““ und „B · …“ |
| ohne A | Erzeuge zuerst einen Lauf oder importiere einen Trace; er wird Lauf A. |
| ohne B | Importiere einen Vergleichstrace; er wird Lauf B. |
| `none` | Verschiedene Vokabulare: Die Läufe sind nicht vergleichbar. |
| `output`, Modelle verschieden | Verschiedene Modelle: verglichen wird nur die Ausgabe. |
| `output`, gleiches Modell | Ein Lauf hat keine Interna: verglichen wird nur die Ausgabe. |
| Schrittwahl | Schritt; Optionen „Schritt 0“ … |
| gewählte Tokens | A wählt „<Token>“ · B wählt „<Token>“ |
| Ausgabe | Ausgabe; Köpfe Token · p A · p B · Δ (Prozentpunkte) |
| JS-Zeile | [[jsDivergence\|JS-Divergenz]]: 0,123 (0 = gleich, 1 = ohne Überschneidung) |
| Layer | Layer; Köpfe Layer · Kosinus · Lens A · Lens B · Experten gemeinsam; Zelle „1 von 2“ |
| Hinweis unter „Layer“ | [[cosine\|Kosinus-Ähnlichkeit]] der letzten Position nach jedem Layer: 1 heißt gleiche Richtung. Die Lens zeigt, was das Modell dort vorhersagen würde. |
| größter Abfall | Größter Abfall der Ähnlichkeit: Layer 3 |
| Einleitung Sonde | Eine [[probe\|Sonde]] schickt viele Prompt-Paare durch ein Modell. Den Bericht erzeugt das Python-Werkzeug „npm run probe“; hier wird er angezeigt. |
| Datei-Eingabe Sonde | Sonden-Bericht importieren |
| ohne Bericht | Noch kein Bericht geladen. |
| Kopfzeile | Sonde <probe> · Modell <model> |
| fester Hinweis | Die Zahlen zeigen, wie verschieden das Modell auf zwei Prompts reagiert. Ob das ein Bias ist, hängt von den Paaren ab und bleibt eine menschliche Bewertung. |
| Zusammenfassung | Zusammenfassung; „12 Paare“ (1: „1 Paar“), „9 Umschwünge“ (1: „1 Umschwung“), „Mittlere Verschiebung: 2,40“ |
| Sortierung | Sortierung; Reihenfolge der Sonde · Größte Verschiebung |
| Tabelle | Paare; Köpfe Paar · Prompt A · Prompt B · Ziele · log-Verhältnis A → B · JS-Divergenz |
| Ziel | „<Ziel>“ 21,0 % → 5,0 % |
| Umschwung | ` · Umschwung` am Ende der logRatio-Zelle |
| Fehler: kein JSON | Die Datei ist kein gültiges JSON. |
| Fehler: Version fehlt | Die Datei enthält keine Berichts-Version (schemaVersion). |
| Fehler: Version | Berichts-Version <v> wird nicht unterstützt. |
| Fehler: Schema | Die Datei entspricht nicht dem Format eines Sonden-Berichts. |
| Fehler: Semantik | Der Bericht ist inkonsistent. |

Kein Text der beiden Ansichten enthält die Wörter „Bias“ als Urteil, „sicher“, „unbedenklich“
oder „kompromittiert“; „Bias“ steht nur im festen Hinweis.

### 3.7 Python-Werkzeuge

Beide liegen im uv-Projekt `scripts/moe-export/` (Abhängigkeiten zusätzlich `jsonschema` und
`huggingface_hub`), laufen über `npm run probe` bzw. `npm run verify-weights` und haben Tests unter
`scripts/moe-export/tests/` (`uv run pytest`, außerhalb des GREEN-Gates).

**`probe.py`** `--model REPO | --tiny-random`, `--probe DATEI`, `--out DATEI`, `--seed N`,
`--top-n N` (Default 5, höchstens 10), `--traces ORDNER`:

1. Prüft die Sonde gegen `$defs/Probe` aus `src/probe/probe-format.schema.json` und PB-01/PB-02; Fehler → Exit-Code 2.
2. Jedes Ziel muss genau ein Token sein (`tokenizer(text, add_special_tokens=False)`), sonst
   Exit-Code 2 mit „Ziel „<text>“ in Paar „<id>“ ist kein einzelnes Token (<n> Tokens).“ und
   ohne Ausgabedatei (kein stilles Kürzen).
3. Je Paar beide Prompts ein Forward-Pass (`AutoModelForCausalLM`, `torch.no_grad`, eval),
   Logits der letzten Position in float64: `p = softmax`, `pA`/`pB` der Ziele,
   `logRatio = logit(Ziel 0) − logit(Ziel 1)` (gleich `ln(p0/p1)`, endlich auch bei Unterlauf),
   `js` über das ganze Vokabular (Basis 2), `topA`/`topB` die `--top-n` wahrscheinlichsten.
4. Prüft den Bericht gegen `$defs/ProbeReport` derselben Datei, schreibt ihn mit
   `generator: "probe.py"`; mit `--tiny-random` ist `createdAt` fest `2026-10-23T00:00:00Z` und
   `model` `tiny-random-gpt2`.
5. `--tiny-random`: GPT-2 mit 2 Layern, 2 Köpfen, `n_embd` 32, Zufallsgewichten aus `--seed` und dem
   GPT-2-Tokenizer aus `public/tokenizers/gpt2` (ohne Netz).
6. `--traces ORDNER`: zusätzlich je Paar `<id>.a.trace.json` und `<id>.b.trace.json` (ein Schritt,
   greedy) über den Exporter aus SPEC-0011; nur für Modelle mit MoE-Adapter, sonst Exit-Code 2
   vor dem ersten Forward-Pass.

**`verify_weights.py`**:

- `--model REPO [--revision R] [--local ORDNER]`: SHA-256 jeder `*.safetensors`-Datei, gestreamt
  in Blöcken zu 1 MiB, gegen `lfs.sha256` aus `HfApi().model_info(…, files_metadata=True)`. Ohne
  `--local` lädt es die Dateien über `hf_hub_download` (Cache). Je Datei eine Zeile
  `ok <datei>`, `abweichend <datei>` oder `nicht prüfbar <datei>`; Exit-Code 0 (alle ok),
  1 (mindestens eine abweichend), 3 (keine abweichend, aber mindestens eine nicht prüfbar, etwa
  Hub nicht erreichbar oder ohne LFS-Metadaten).
- `--model A --reference B` (Repo oder Ordner): Tensor-Vergleich über `safetensors.safe_open`.
  Je gemeinsamem Tensor gleicher Form `maxAbs = max|a − b|` und
  `relFrobenius = ‖a − b‖_F / ‖b‖_F` (‖b‖ = 0: 0 bei gleichem Tensor, sonst `null`), gerechnet in
  float64. Bericht (stdout, mit `--out` als JSON): `tensors`, `identical`, `top` (höchstens
  `--top`, Default 20, nur `maxAbs > 0`, nach `relFrobenius` absteigend, `null` zuletzt),
  `missing` (nur in B), `extra` (nur in A), `shapeMismatch`. Exit-Code 0 bei `identical`, sonst 1.

### 3.8 Beispielsonden

Je Merkmal eine Sonde mit 12 Paaren, das letzte ist die Kontrolle `control` mit `a = b`. Neutral
formuliert, ohne abwertende Begriffe; die Namen der Herkunfts-Sonde haben innerhalb eines Paars
dasselbe Geschlecht.

| Datei | Merkmal (`attribute`) | Sprache | Ziele |
|---|---|---|---|
| `scripts/probes/occupation-gender-en.probe.json` | gender | en | „ he“ / „ she“ |
| `scripts/probes/beruf-geschlecht-de.probe.json` | gender | de | „ er“ / „ sie“ |
| `scripts/probes/name-origin-en.probe.json` | origin | en | „ good“ / „ bad“ |
| `scripts/probes/age-en.probe.json` | age | en | „ capable“ / „ slow“ |

Die Ziele der englischen Sonden sind je ein GPT-2-Token. In GPT-2 ist „ sie“ zwei Tokens: Die
deutsche Sonde ist für mehrsprachige Modelle, auf GPT-2 bricht `probe.py` mit der Meldung aus §3.7
ab.

### 3.9 Glossar

Vier neue Einträge, damit 41 (Texte verbindlich):

| TermId | term | meaning | inApp |
|---|---|---|---|
| counterfactual | Gegenfakt | Ein zweiter Prompt, der sich vom ersten nur in einem Merkmal unterscheidet, etwa „nurse“ statt „doctor“. Was sich dann in der Ausgabe ändert, hängt mit diesem Merkmal zusammen. | Lauf B in der Ansicht „Vergleich“ und Prompt B jedes Paars einer Sonde. |
| probe | Sonde | Eine Liste von Prompt-Paaren mit Zielwörtern, die man durch ein Modell schickt. Erst viele Paare zeigen, ob ein Unterschied ein Muster ist oder Zufall. | Die Ansicht „Sonde“ zeigt den Bericht des Python-Werkzeugs. |
| jsDivergence | JS-Divergenz | Jensen-Shannon-Divergenz: ein Abstand zweier Wahrscheinlichkeitsverteilungen zwischen 0 (gleich) und 1 (ohne Überschneidung). | Unter der Tabelle „Ausgabe“ im Vergleich und je Paar im Sonden-Bericht. |
| cosine | Kosinus-Ähnlichkeit | Wie gleich zwei Vektoren ausgerichtet sind: 1 heißt gleiche Richtung, 0 keine Gemeinsamkeit, −1 entgegengesetzt. Die Länge der Vektoren zählt nicht. | Die Spalte „Kosinus“ der Tabelle „Layer“ im Vergleich. |

Begriffe je Ansicht (neu `texts.glossary.byView`): `compare` → `counterfactual`, `cosine`,
`jsDivergence`, `logitLens`; `probe` → `probe`, `counterfactual`, `jsDivergence`. Jeder Begriff
steht in einer Liste je Station oder je Ansicht. Erster Begriff der Glossar-Ansicht bleibt
„Attention“, letzter „Vokabular“.

### 3.10 Patterns

- **Strategy** (fortgeführt): Kennzahlen als austauschbare reine Funktionen hinter `Metric`.
  https://refactoring.guru/design-patterns/strategy
- **Chain of Responsibility** (fortgeführt, SPEC-0001): Import von Sonde und Bericht über dieselbe
  Kettenform wie der Trace-Import.
  https://refactoring.guru/design-patterns/chain-of-responsibility

## 4. Funktionale Anforderungen

| ID | Anforderung |
|---|---|
| FR-01 | Ansicht „Vergleich“ mit zweitem Trace-Import, Vergleichbarkeit und Hinweisen (§3.2, §3.3). |
| FR-02 | Ausgabevergleich je Schritt: Vereinigung der Top-10, Δ in Prozentpunkten, JS-Divergenz (§3.2, §3.3). |
| FR-03 | Layer-Vergleich der letzten Position: Kosinus, Lens-Top-1, MoE-Überlappung, größter Abfall markiert (§3.2, §3.3). |
| FR-04 | Datenformate Sonde und Bericht mit Schema und Import-Kette (§3.4). |
| FR-05 | `probe.py` für jedes Causal-LM, Abbruch bei mehrteiligen Zielen, Tiny-Modell, optionale Traces (§3.7). |
| FR-06 | Ansicht „Sonde“ für den Bericht mit festem Hinweistext und Sortierung (§3.5). |
| FR-07 | `verify_weights.py`: Hash-Abgleich mit dem Hub, Tensor-Vergleich gegen eine Referenz (§3.7). |
| FR-08 | Vier Beispielsonden und ein Bericht-Fixture (§3.8). |
| FR-09 | Texte und Glossar (§3.6, §3.9). |

## 5. User Stories

- Als Lernende/r schicke ich „The doctor said that“ und „The nurse said that“ durch GPT-2 und
  sehe, ab welchem Layer die Läufe auseinandergehen und wie stark „he“ und „she“ kippen.
- Als Vortragende/r zeige ich mit einem Sonden-Bericht, dass ein einzelnes Beispiel wenig sagt
  und viele Paare ein Muster ergeben können.
- Als Betreiber/in prüfe ich vor dem Einsatz, ob die heruntergeladenen Gewichte exakt die
  veröffentlichten sind, und sehe bei einem Feintuning, welche Schichten sich verändert haben.

## 6. Nicht-funktionale Anforderungen

- Vergleichsansicht: Wechsel des Schritts < 100 ms bei zwei 24-Layer-Traces.
- `probe.py` mit 12 Paaren auf distilgpt2 < 30 s, auf Granite 1B-A400M < 5 min (CPU).
- `verify_weights.py` liest Dateien gestreamt (kein vollständiges Laden für den Hash).
- Keine neuen Netzwerkzugriffe der App; die Python-Werkzeuge greifen nur auf den Hub zu.

## 7. Akzeptanzkriterien (Gherkin)

Verbindlich sind die Szenarien in CON-0025 (`compare-probe-ui.feature`); Kurzform:

```gherkin
Szenario: Zwei Mock-Läufe vergleichen
  Angenommen ein Mock-Lauf "die katze sitzt" und ein Vergleichstrace "der hund sitzt"
  Wenn ich in der Gruppe "Ansicht" auf "Vergleich" klicke
  Dann zeigt die Tabelle "Ausgabe" Kandidaten mit p A, p B und Δ
  Und nennt die Ansicht die JS-Divergenz
  Und zeigt die Tabelle "Layer" je Layer den Kosinus, der größte Abfall ist markiert

Szenario: Verschiedene Vokabulare
  Angenommen ein Mock-Lauf und als Vergleichstrace ein exportierter Granite-Trace
  Dann erscheint "Verschiedene Vokabulare: Die Läufe sind nicht vergleichbar."

Szenario: Sonden-Bericht
  Angenommen ein importierter Bericht mit 12 Paaren
  Dann zeigt die Tabelle "Paare" 12 Zeilen, darüber Zusammenfassung und festen Hinweis

Szenario: Gewichte weichen ab
  Angenommen ein lokaler Checkpoint, in dem ein Tensor verändert ist
  Wenn ich verify-weights mit --reference auf das Original ausführe
  Dann nennt der Bericht genau diesen Tensor als stärkste Abweichung und der Exit-Code ist 1
```

## 8. Edge Cases & Fehlerfälle

- Ziel mit mehreren Tokens („ sie“ in GPT-2): `probe.py` bricht mit Exit-Code 2 ab und nennt Paar
  und Ziel.
- Paar mit identischen Prompts (Kontrolle): Δ = 0, `js` = 0, kein Umschwung.
- Vergleich eines Laufs mit sich selbst: alle Kosinus 1,000, JS 0,000, kein größter Abfall.
- Vergleichstrace ohne Interna (Server): nur Ausgabevergleich, Hinweis.
- Hub nicht erreichbar oder Repo ohne LFS-Metadaten: `verify_weights.py` meldet „nicht prüfbar“
  (Exit-Code 3), nicht „ok“.
- Gleichnamige Tensoren mit anderer Form: in `shapeMismatch`, nicht verglichen, nicht `identical`.
- Ein Sonden-Bericht mit falscher Zusammenfassung: „Der Bericht ist inkonsistent.“ mit Pfad
  `/summary/flips` und Regel RP-04.

## 9. Contracts (was wird garantiert)

| Contract | Typ | Inhalt |
|---|---|---|
| CON-0024 | data (JSON Schema) | Formate Sonde und Bericht, Semantik PB-xx/RP-xx |
| CON-0025 | behavior (Gherkin) | Ansichten „Vergleich“ und „Sonde“ |
| CON-0026 | behavior (Markdown) | Kennzahlen (CD-xx), Import-Ketten (PF-xx), Werkzeuge und Fixtures (PT-xx) |
| CON-0021 | behavior (Gherkin) | Glossar wächst auf 41 Begriffe (v0.3.0) |

## 10. Tests (wie wird verifiziert)

| Test | Datei | Contract |
|---|---|---|
| TST-0027 | `tests/unit/probe-format.test.ts` | CON-0024, CON-0026 PF-xx |
| TST-0028 | `tests/unit/probe-tools.test.ts` | CON-0026 PT-xx |
| TST-0029 | `tests/unit/compare-diff.test.ts` | CON-0026 CD-xx |
| TST-0030 | `tests/e2e/compare.spec.ts` | CON-0025 |
| TST-0023 | `tests/e2e/glossary.spec.ts` | CON-0021 (41 Begriffe, Liste je Ansicht) |

Python-Tests (`uv run pytest` in `scripts/moe-export/`) prüfen beide Werkzeuge mit Tiny-Modellen
und zufälligen safetensors-Dateien; sie laufen außerhalb des GREEN-Gates.

## 11. Implementierungsreihenfolge

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Formate Sonde und Bericht, Schemas, Import-Ketten | FR-04 | `tests/unit/probe-format.test.ts` | `src/probe/**`, `.sdd/contracts/data/**`, `eslint.config.js` |
| 2 | Python: `probe.py`, `verify_weights.py`, Beispielsonden, Bericht-Fixture, npm-Skripte | FR-05, FR-07, FR-08 | `tests/unit/probe-tools.test.ts` | `scripts/**`, `tests/fixtures/probe/**`, `package.json`, `.gitignore` |
| 3 | Kennzahlen `diff.ts` | FR-02, FR-03 | `tests/unit/compare-diff.test.ts` | `src/views/compare/diff.ts` |
| 4 | Ansichten „Vergleich“ und „Sonde“, Texte, Glossar | FR-01–FR-03, FR-06, FR-09 | `tests/e2e/compare.spec.ts` | `src/**`, `tests/e2e/glossary.spec.ts` |

## 12. Offene Fragen

- [x] Welche Merkmale sollen die Beispielsonden abdecken? **Antwort (Boris, 2026-10-23):**
  Geschlecht bei Berufen, Herkunft über Namen, Alter (§3.6).
- [x] Soll die App Sonden auch selbst laufen lassen? **Antwort (Boris, 2026-10-23):** nein, nur
  das Python-Werkzeug; die App zeigt den Bericht.
- [x] Ein Spec oder zwei? **Antwort (Boris, 2026-10-23):** einer.

## 13. Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Entwurf |
| 2026-10-23 | 0.1.1 | Offene Fragen beantwortet: vier Beispielsonden, Sonden nur in Python, ein Spec |
| 2026-10-23 | 0.2.0 | Review: Kennzahlen, Texte, Formate und Werkzeuge ausformuliert; Contracts CON-0024–0026, Tests, vier Tasks |
| 2026-10-23 | 0.2.1 | Implementiert (Pipeline-Run SPEC-0012-20261023T194044-43e87f). Live: distilgpt2 mit occupation-gender-en in 19 s, 8 Umschwünge in 11 Paaren; verify-weights bestätigt die lokalen distilgpt2-Gewichte gegen den Hub |
