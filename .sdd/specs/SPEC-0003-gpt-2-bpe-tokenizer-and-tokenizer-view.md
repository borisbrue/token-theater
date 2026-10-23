---
id: SPEC-0003
title: "GPT-2 BPE tokenizer and tokenizer view"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.2.0
priority: high          # low | medium | high | critical
tags: [tokenizer, bpe, ui, trace]
depends_on: ["SPEC-0001", "SPEC-0002"]
contracts: ["CON-0008", "CON-0009"]
tests: ["TST-0008", "TST-0009", "TST-0010"]
fr_test_map:
  FR-01: [TST-0008]
  FR-02: [TST-0008]
  FR-03: [TST-0008]
  FR-04: [TST-0008]
  FR-05: [TST-0008, TST-0010]
  FR-06: [TST-0009]
  FR-07: [TST-0009]
  FR-08: [TST-0010]
  FR-09: [TST-0010]
  FR-10: [TST-0010]
  FR-11: [TST-0010]
  FR-12: [TST-0010]
  FR-13: [TST-0010, TST-0008]
---

# GPT-2 BPE tokenizer and tokenizer view

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.0
> Grundlage: `.sdd/docs/architecture/vision.md` (Station 1 „Tokenisierung“), ADR-0001 (Aurora)

## 1. Kontext & Motivation

Die erste Station jedes Durchlaufs ist die Tokenisierung: Bevor ein Sprachmodell rechnet, wird der
Text in Tokens zerlegt, und jedes Token bekommt eine Nummer. Für Lernende ist das die erste
Überraschung („Katze“ ist für GPT-2 zwei Tokens, ein Emoji drei) und für Vortragende der
natürliche Einstieg.

Bisher gibt es nur den Wort-Tokenizer der MockEngine (52 Wörter). Die GPT-2-Engine (SPEC-0006)
braucht den echten GPT-2-Tokenizer: byte-level Byte-Pair-Encoding (BPE) mit 50 257 Tokens und
50 000 Merge-Regeln. Diese Spec liefert ihn als eigenständiges, getestetes Modul und macht ihn
sichtbar: in einer **Tokenizer-Werkbank**, in der man beliebigen Text live zerlegt und für jedes
Wort Merge für Merge nachverfolgt, und als **Ansicht der tokenize-Station** im Player.

## 2. Zielsetzung

**Primärziel:** Ein bytegenauer GPT-2-BPE-Tokenizer in TypeScript plus eine Ansicht, die Tokens,
IDs und die einzelnen BPE-Merges zeigt.

**Erfolgskriterien (messbar):**
- [ ] Für alle Referenztexte aus CON-0008 liefert der Tokenizer exakt dieselben IDs wie die Referenzimplementierung (tiktoken, Kodierung `gpt2`).
- [ ] `decode(tokenize(t))` ergibt für jeden Text `t` wieder `t` (Umlaute, Emoji, Leerzeichenfolgen, Zeilenumbrüche, Tabulatoren).
- [ ] Die Werkbank zerlegt einen Text von 1000 Zeichen nach dem Laden des Vokabulars ohne spürbare Verzögerung (< 50 ms je Eingabe).
- [ ] Vokabular und Merges werden vom eigenen Origin geladen, erst beim Öffnen der Werkbank, und landen nicht im JavaScript-Bundle.
- [ ] Ein Trace mit BPE-Details übersteht Export und Import, und die tokenize-Station zeigt dieselben Merges wie die Werkbank.
- [ ] Alle Tests aus SPEC-0001 und SPEC-0002 bleiben grün.

**Nicht-Ziele (explizit):**
- GPT-2-Engine und Forward-Pass → SPEC-0006 (sie nutzt diesen Tokenizer)
- Tokenizer anderer Modelle (SentencePiece, Llama, Ollama-Modelle) → bei Bedarf eigene Specs
- Spezialtokens im Text: `<|endoftext|>` im Eingabetext wird als normaler Text kodiert, nicht als Token 50256
- Abspielen der Merges mit dem Playback-Controller (die Merges stehen als Liste da; Animation ggf. SPEC-0008)
- Änderung der MockEngine: sie behält ihren Wort-Tokenizer
- Bereinigung „Erzeugter Text“ gegenüber Tokenstrom und sichtbare Leerzeichen im Tokenstrom → SPEC-0008 (der Tokenstrom zeigt weiter `Token.text`)

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/engine/tokenizer/   byte-level.ts, pretokenize.ts, bpe.ts (BpeTokenizer), gpt2.ts (Laden + Prüfen)
src/trace/              types.ts + Schema: optionales Feld `bpe` an der tokenize-Station, INV-16
src/views/tokenization/ TokenizationView, BpeSteps, token-display.ts (reine Funktionen) – nur Props
src/app/tokenizer/      TokenizerWorkbench (lädt den Tokenizer, hält den Text), gpt2-loader.ts
src/app/                App: Umschalter „Durchlauf | Tokenizer“; Player registriert den tokenize-Renderer
public/tokenizers/gpt2/ vocab.json, merges.txt, LICENSE (statische Assets, eigener Origin)
```

Die Schichtregeln aus CON-0004 gelten unverändert: `src/engine/tokenizer` kennt kein React und
importiert aus `src/trace` nur Typen; Views importieren nicht aus `src/engine` oder `src/app`. Die
App-Schicht lädt den Tokenizer und reicht nur Daten (`Token[]`, `BpeDetail`) an die Views weiter.

### 3.2 Byte-level BPE (Algorithmus)

1. **Bytes → Symbole:** Jedes der 256 Bytes hat ein druckbares Unicode-Zeichen (GPT-2-Tabelle
   `bytes_to_unicode`: `!`–`~`, `¡`–`¬`, `®`–`ÿ` auf sich selbst, die übrigen 68 Bytes der Reihe
   nach auf U+0100 ff.; Leerzeichen → `Ġ`, Zeilenumbruch → `Ċ`). Damit gibt es kein „unbekanntes
   Zeichen“: Alles, was nicht im Vokabular steht, zerfällt höchstens in Einzelbytes.
2. **Vorzerlegung (Pre-Tokens):** Der Text wird mit dem GPT-2-Muster
   `'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+` (Flag `u`) in
   Wörter zerlegt. Merges wirken nur innerhalb eines Pre-Tokens.
3. **Merges:** Je Pre-Token startet die Folge mit den Einzelbyte-Symbolen. Solange ein benachbartes
   Paar eine Merge-Regel hat, wird das Paar mit dem **kleinsten Rang** (Zeile in `merges.txt`)
   an **allen** Stellen von links nach rechts zusammengefasst. Jede Runde ist eine **Stufe**.
4. **IDs:** Die Symbole der letzten Stufe werden über `vocab.json` zu IDs.

Ein Cache je Pre-Token (Map, Text → Ergebnis) macht wiederholte Wörter billig; er ändert keine Ergebnisse (3.6).

### 3.3 Strategy (Behavioral): Tokenizer bleibt austauschbar

**Anwendung:** `BpeTokenizer` implementiert das bestehende Interface `Tokenizer` aus
`src/engine/types.ts`. Das Interface bekommt eine **optionale** Fähigkeit
`explain?(text: string): BpeDetail`. Der Generator fragt nur diese Fähigkeit ab: Ist sie da,
hängt er die Details an die tokenize-Station; sonst bleibt alles wie bisher (MockEngine,
später Remote).

**Begründung:** Engines bleiben austauschbar; keine Sonderfälle für „GPT-2“ im Generator oder in
den Views. Die Views erkennen die Details am Trace, nicht an der Engine.

**Alternative:** Ein eigener Stationstyp `bpe`. Abgelehnt: Er würde die Stationsreihenfolge
(INV-05), die Stationsleiste und alle Playback-Tests ändern, ohne neue Rechnung abzubilden.

Quelle: https://refactoring.guru/design-patterns/strategy

### 3.4 Factory Method (Creational): Laden und Prüfen der Tabellen

**Anwendung:** `loadGpt2Tokenizer({ baseUrl, fetch })` holt `vocab.json` und `merges.txt`,
`parseGpt2Tables(vocabJson, mergesTxt)` prüft sie (Anzahl, Eindeutigkeit, EOS-ID, jedes Merge-Paar
und sein Ergebnis im Vokabular) und baut daraus den `BpeTokenizer`. Fehler sind ein
`TokenizerLoadError` mit `kind: 'network' | 'format'`. `fetch` ist injiziert, damit Unit-Tests
die Dateien aus dem Repo lesen.

Der Konstruktor `new BpeTokenizer(tables, options)` erhält bereits geprüfte `BpeTables` und
prüft selbst nicht erneut; so laufen Unit-Tests auch mit Mini-Tabellen ohne die 1,5-MB-Assets.
`parseGpt2Tables` prüft in fester Reihenfolge (Chain of Responsibility, wie die Import-Kette aus
SPEC-0001): erst billige Strukturfehler (JSON, Kopfzeile, Anzahl), dann Eindeutigkeit und EOS,
zuletzt die Abdeckung der Merges. Der erste Fehler wird zum `TokenizerLoadError('format')`.

**Begründung:** Ein kaputtes oder abgeschnittenes Vokabular soll laut scheitern, nicht still
falsche IDs liefern.

**Alternative:** Builder (`addVocab`/`addMerges`/`build`). Abgelehnt: Die Tabellen kommen immer
vollständig, ein Builder machte ungültige Zwischenzustände sichtbar.

Quelle: https://refactoring.guru/design-patterns/factory-method

### 3.5 Trace-Erweiterung `bpe` (CON-0001 v0.3.0)

```ts
interface BpeWord {
  text: string;          // Pre-Token, z. B. " Katze"
  bytes: number[];       // UTF-8 des Pre-Tokens
  stages: number[][][];  // stages[0] = Einzelbytes; stages[i+1] = nach Merge-Runde i; je Symbol seine Bytes
  ranks: number[];       // Rang der Merge-Regel je Runde, Länge stages.length − 1
  ids: number[];         // Token-IDs der letzten Stufe
}
interface BpeDetail { words: BpeWord[] }
interface TokenizeStation { kind: 'tokenize'; tokens: Token[]; bpe?: BpeDetail }
```

Die Symbole stehen als **Bytes**, nicht im GPT-2-Zeichensatz (`Ġ`). So bleibt das Format
tokenizerneutral, und die Ansicht kann unvollständige UTF-8-Folgen (halbe Emoji) als Hex zeigen,
ohne die GPT-2-Tabelle zu kennen. `schemaVersion` bleibt 1: Das Feld ist optional, alte Traces
bleiben gültig. Neue Invariante INV-16 (Konsistenz, Details in CON-0001).

`Token.text` eines BPE-Tokens ist die UTF-8-Dekodierung seiner Bytes **mit Ersatzzeichen**
(U+FFFD) für unvollständige Folgen. `decode(tokens)` setzt erst die Bytes aller Tokens zusammen
und dekodiert dann, daher kommt das Emoji dort wieder heil heraus.

### 3.6 Virtual Proxy (Structural): Laden einmal je Seite

**Anwendung:** `src/app/tokenizer/gpt2-loader.ts` bietet `getGpt2Tokenizer()` mit derselben
Rückgabe wie `loadGpt2Tokenizer`, lädt aber erst beim ersten Aufruf und hält danach ein
modullokales Promise. Ein Fehlschlag wird verworfen, der nächste Aufruf lädt neu. Der
Pre-Token-Cache im `BpeTokenizer` ist ebenfalls nur ein Beschleuniger: `encode` und `explain`
liefern mit kaltem und warmem Cache dieselben Ergebnisse.

**Alternative:** Singleton in `src/engine`. Abgelehnt: globaler Zustand erschwert Tests mit
injiziertem `fetch` und kann einen Fehlschlag nicht zurücksetzen.

Quelle: https://refactoring.guru/design-patterns/proxy

### 3.6a Chain of Responsibility (Behavioral): INV-16 im Import

INV-16 ist ein eigenes Glied der semantischen Prüfung in `src/trace/invariants.ts`; Traces ohne
`bpe` laufen unverändert durch.

Quelle: https://refactoring.guru/design-patterns/chain-of-responsibility

### 3.6b Anzeige von Tokens (reine Funktionen, `token-display.ts`)

- **Sichtbare Leerzeichen:** Leerzeichen → `␣`, Zeilenumbruch → `↵`, Tabulator → `⇥`,
  Wagenrücklauf → `␍`; alle anderen Zeichen bleiben.
- **Unvollständiges UTF-8:** Bytes, die kein gültiges UTF-8 ergeben, erscheinen als Hex in
  spitzen Klammern, Großbuchstaben, mit Leerzeichen getrennt: `<F0 9F>`.
- **Farben:** Benachbarte Tokens wechseln zyklisch durch vier Akzentfarben des Themes (Klassen
  `tok-0` … `tok-3`, Farbwerte nur in `src/app/theme/`). Die Schrift bleibt `--tt-text` auf
  dunklem Grund (Kontrast wie CON-0007).
- Ohne BPE-Details (MockEngine) zeigt die Ansicht `Token.text` mit denselben Leerzeichen-Regeln.

### 3.7 Lokale UI-Zustände

Die Werkbank hält Text und Auswahl als React-State in der App-Schicht; die Auswahl (welches
Pre-Token gerade erklärt wird) liegt in `TokenizationView` selbst. Ein neuer Text setzt die Auswahl
zurück. Der Tokenizer wird einmal je Seitenaufruf geladen (gemeinsames Promise in
`gpt2-loader.ts`), auch wenn man mehrfach umschaltet; ein Fehlschlag wird nicht gecacht
(„Erneut versuchen“ lädt neu).

### 3.8 Seitenaufbau

Unter dem Kopf steht eine Gruppe „Ansicht“ mit zwei Umschaltknöpfen „Durchlauf“ und „Tokenizer“
(`aria-pressed`, Default „Durchlauf“). „Durchlauf“ zeigt die Seite wie bisher (Inspector-Steuerung,
Player, Details). „Tokenizer“ ersetzt diesen Bereich durch die Region „Tokenizer“; der Player ist
dann nicht eingehängt, seine Tastaturkürzel greifen nicht. Beim Zurückschalten sind Trace und
Cursor unverändert.

**Region „Tokenizer“** von oben nach unten: Textfeld „Text“ (mehrzeilig, Vorbelegung
„Die Katze schläft auf dem Sofa.“, höchstens 1000 Zeichen) → Kennzahlen („31 Zeichen · 32 Bytes ·
13 Tokens“) → Tokenliste „Tokens“ → IDs als eine Zeile → BPE-Schritte des gewählten Pre-Tokens
oder ein Hinweis, dass man ein Token wählen kann.

### 3.9 Festlegungen für die test-first geschriebenen Tests

- **Module:** `@/engine/tokenizer/byte-level` exportiert `BYTE_TO_UNICODE` (256 Zeichen, Index =
  Byte) und `UNICODE_TO_BYTE` (Map). `@/engine/tokenizer/pretokenize` exportiert
  `pretokenize(text): string[]` und `GPT2_PATTERN`. `@/engine/tokenizer/bpe` exportiert
  `BpeTokenizer` (`encode`, `tokenize`, `decode`, `decodeIds`, `tokenBytes`, `explain`,
  `vocabSize`, `eosTokenId`) und den Typ `BpeTables`. `@/engine/tokenizer/gpt2` exportiert
  `GPT2_EOS_TOKEN_ID = 50256`, `GPT2_VOCAB_SIZE = 50257`, `GPT2_MERGE_COUNT = 50000`,
  `GPT2_ASSET_DIR = 'tokenizers/gpt2/'`, `parseGpt2Tables`, `loadGpt2Tokenizer`,
  `TokenizerLoadError`. `@/views/tokenization/token-display` exportiert `displayText(text)` und
  `displayBytes(bytes)`.
- **Assets:** `public/tokenizers/gpt2/vocab.json` und `merges.txt` sind die Originaldateien von
  `openai-community/gpt2` (SHA-256 in CON-0008); `LICENSE` enthält die „Modified MIT License“ von OpenAI (openai/gpt-2).
  `public/tokenizers/` ist von Prettier ausgenommen.
- **DOM:** Gruppe „Ansicht“ mit Knöpfen „Durchlauf“/„Tokenizer“. Region „Tokenizer“; Textfeld mit
  Label „Text“; Liste „Kennzahlen“; Liste „Tokens“ (in der Werkbank je Eintrag ein Knopf mit
  `aria-pressed`); Liste „Merges“ in der Region „BPE-Schritte“. Die Stationsansicht der
  tokenize-Station enthält dieselbe Liste „Tokens“ (ohne BPE-Details als nicht klickbare Einträge
  plus Hinweis). Zusätzliche Überschriften in „Station“ sind `h3` (genau eine `h2` bleibt).

## 4. Funktionale Anforderungen

- **FR-01:** `src/engine/tokenizer/byte-level.ts` liefert die GPT-2-Byte-Tabelle (3.2, Punkt 1) und ihre Umkehrung; `pretokenize.ts` zerlegt Text mit dem GPT-2-Muster in Pre-Tokens, deren Verkettung wieder den Text ergibt.
- **FR-02:** `src/engine/tokenizer/bpe.ts` implementiert `BpeTokenizer` (Interface `Tokenizer`) nach 3.2: `encode(text) → number[]`, `tokenize(text) → Promise<Token[]>` (Text je Token nach 3.5), `decode(tokens)`/`decodeIds(ids)` (Bytes verketten, dann UTF-8 mit Ersatzzeichen), `tokenBytes(id)`, `explain(text) → BpeDetail` (3.5). Unbekannte IDs in `decode*`/`tokenBytes` werfen einen `RangeError`. Spezialtokens im Text werden nicht erkannt.
- **FR-03:** Für die Referenztexte aus CON-0008 stimmen die IDs exakt mit tiktoken (`gpt2`) überein; `decodeIds(encode(t)) === t` für jeden Text.
- **FR-04:** `src/engine/tokenizer/gpt2.ts` lädt `vocab.json` und `merges.txt` über ein injiziertes `fetch` relativ zu `baseUrl` + `GPT2_ASSET_DIR`, prüft sie nach 3.4 und liefert einen `BpeTokenizer` mit `eosTokenId = 50256`. Netzwerkfehler bzw. HTTP-Status ≠ 2xx → `TokenizerLoadError('network')`, ungültiger Inhalt → `TokenizerLoadError('format')`.
- **FR-05:** Die Assets liegen unter `public/tokenizers/gpt2/` (inkl. `LICENSE`), werden erst beim ersten Öffnen der Werkbank vom eigenen Origin geladen und sind nicht Teil des JavaScript-Bundles.
- **FR-06:** Das Trace-Format bekommt das optionale Feld `bpe` an der tokenize-Station (3.5) samt Schema und INV-16 (CON-0001 v0.3.0); Export/Import erhalten es JSON-tief gleich.
- **FR-07:** Der Generator hängt `bpe = tokenizer.explain(prompt)` an die tokenize-Station, wenn der Tokenizer `explain` anbietet; sonst fehlt das Feld (MockEngine-Traces bleiben bytegleich).
- **FR-08:** Die App zeigt eine Gruppe „Ansicht“ mit „Durchlauf“ und „Tokenizer“ (3.8); Umschalten erhält Trace und Cursor, und in der Werkbank greifen die Player-Kürzel nicht.
- **FR-09:** Die **Tokenizer-Werkbank** (`src/app/tokenizer/`) zeigt ein Textfeld „Text“ und zerlegt bei jeder Eingabe neu: Kennzahlen (Zeichen = Unicode-Codepoints, Bytes = UTF-8, Tokens), Tokenliste und IDs-Zeile. Während des Ladens erscheint „GPT-2-Vokabular wird geladen …“, bei einem Fehler eine Meldung (`role="alert"`) mit Knopf „Erneut versuchen“.
- **FR-10:** Die **Tokenliste** (`src/views/tokenization/`) zeigt je Token den Anzeigetext nach 3.6b und die ID; benachbarte Tokens haben unterschiedliche Farbklassen.
- **FR-11:** Wählt man in der Tokenliste ein Token, zeigt die Region „BPE-Schritte“ für dessen Pre-Token die Überschrift „BPE-Schritte für „<Anzeigetext>““ und die Liste „Merges“: Eintrag 0 „Start“ mit den Einzelbytes, je Merge-Runde ein Eintrag „Merge i · Rang r“ mit der Symbolfolge danach; das neu entstandene Symbol ist hervorgehoben. Alle Tokens des gewählten Pre-Tokens tragen `aria-pressed="true"`.
- **FR-12:** Die **Stationsansicht der tokenize-Station** nutzt einen registrierten Renderer (Registry aus SPEC-0002 §3.8): Erklärtext, Tokenliste und – falls der Trace `bpe` enthält – dieselbe Auswahl mit BPE-Schritten wie in der Werkbank; ohne `bpe` der Hinweis „Dieser Trace enthält keine BPE-Schritte.“
- **FR-13:** Alle neuen Texte stehen in `src/app/texts.ts`; Views bekommen sie als Props. Farbwerte stehen nur in `src/app/theme/`. Es gibt weiterhin keine Anfragen an fremde Origins.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                    | um ...                                                       |
|-------|----------------|-------------------------------------------------------------------|--------------------------------------------------------------|
| US-01 | Lernende/r     | eigenen Text eintippen und sofort seine Tokens und IDs sehen       | zu verstehen, wie das Modell Text „sieht“                    |
| US-02 | Vortragende/r  | für ein Wort Merge für Merge zeigen, wie BPE es zusammensetzt      | den Algorithmus am Beispiel zu erklären                      |
| US-03 | Lernende/r     | sehen, warum Umlaute und Emoji in mehrere Tokens zerfallen         | Byte-level-Tokenisierung zu begreifen                        |
| US-04 | Vortragende/r  | im Player bei der Station „tokenize“ dieselbe Ansicht bekommen     | den Durchlauf ohne Wechsel der Ansicht zu erzählen           |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Korrektheit     | IDs bytegleich zu tiktoken `gpt2` für alle Referenztexte; verlustfreier Round-Trip |
| Performance     | `encode` von 10 000 Zeichen < 500 ms in Node (kalter Cache); Werkbank-Eingabe bis 1000 Zeichen < 50 ms |
| Ladeverhalten   | Assets lazy, eigener Origin, nicht im JS-Bundle; JS-Bundle wächst um < 30 KB (gzip) |
| Accessibility   | wie SPEC-0002: Kontrast ≥ 4.5:1, Tastaturbedienung, Knöpfe ≥ 44 px in der Höhe |
| Lizenz          | GPT-2-Vokabular unter der „Modified MIT License“ (OpenAI), Lizenztext liegt neben den Assets |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: GPT-2-Tokenizer

  Scenario: Werkbank zerlegt Text
    Given die Ansicht "Tokenizer" ist geöffnet
    When ich "Die Katze schläft auf dem Sofa." eingebe
    Then zeigt die Liste "Tokens" 13 Einträge, der zweite ist "␣Kat" mit ID 8595

  Scenario: Emoji zerfällt in Bytes
    When ich "🦊 Füchse" eingebe
    Then ist der erste Eintrag "<F0 9F>" mit ID 8582

  Scenario: BPE-Schritte
    When ich das Token "␣Kat" wähle
    Then zeigt die Liste "Merges" 5 Einträge, beginnend mit "Start"

  Scenario: tokenize-Station im Player
    Given ein Mock-Trace ist erzeugt
    Then zeigt die Station "tokenize" die Tokens mit IDs und den Hinweis auf fehlende BPE-Schritte
```

Die verbindlichen Szenarien stehen in den Contracts (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Leerer Text in der Werkbank: 0 Tokens, leere IDs-Zeile, kein Fehler.
- Nur Leerzeichen bzw. Leerzeichenfolgen vor einem Wort (`\s+(?!\S)`): korrekt wie tiktoken.
- Zeichen außerhalb der BMP und kombinierende Zeichen: Round-Trip bleibt verlustfrei.
- `<|endoftext|>` im Text: als normaler Text kodiert (mehrere Tokens), nicht als ID 50256.
- Vokabular nicht ladbar (404, Netzwerk) oder abgeschnitten: Fehlermeldung, „Erneut versuchen“; die übrige App bleibt nutzbar.
- Import eines Traces mit inkonsistentem `bpe`: `semantic`-Fehler mit `INV-16`.
- Import eines alten Traces ohne `bpe`: unverändert gültig.
- Pre-Token ohne Merge (z. B. „.“): genau ein Eintrag „Start“ in der Liste „Merges“.

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0008 | behavior (markdown) | GPT-2-BPE-Tokenizer: Byte-Tabelle, Vorzerlegung, Merges, Referenzvektoren, Laden/Prüfen, Fehler, `explain`, Generator-Anbindung |
| CON-0009 | behavior (gherkin)  | Tokenizer-UI: Umschalter, Werkbank, Tokenliste, BPE-Schritte, tokenize-Station im Player |
| CON-0001 | data (Änderung → v0.3.0) | optionales Feld `bpe` an der tokenize-Station, INV-16 |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0008 | unit       | CON-0008: Tokenizer gegen Referenzvektoren, Round-Trip, Tabellen, Laden/Fehler, explain, Performance |
| TST-0009 | unit       | CON-0001 v0.3.0 / CON-0008: `bpe` im Trace (Schema, INV-16, Round-Trip, Generator) |
| TST-0010 | acceptance | CON-0009: Playwright-Szenarien der Tokenizer-UI |

## 11. Implementierungsreihenfolge

Genau drei Tasks, je einer pro vorhandener (committeter) Testsuite. Assets, `LICENSE`,
`.prettierignore`, die Schema-Kopie `src/trace/trace.schema.json` und das Fixture
`tests/fixtures/traces/gpt2-bpe.trace.json` liegen bereits vor.

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | GPT-2-BPE-Tokenizer: byte-level, pretokenize, bpe, gpt2-Laden, Typen `BpeWord`/`BpeDetail` | FR-01–FR-05 | `tests/unit/gpt2-tokenizer.test.ts` | `src/engine/tokenizer/**`, `src/engine/types.ts`, `src/trace/types.ts` |
| 2 | BPE-Details im Trace (Schema-Validierung, INV-16) und Generator | FR-06, FR-07 | `tests/unit/trace-bpe-detail.test.ts` | `src/trace/**`, `src/engine/generate.ts`, `src/engine/types.ts` |
| 3 | Tokenizer-Werkbank, Umschalter, tokenize-Station | FR-08–FR-13 | `tests/e2e/tokenizer.spec.ts` | `src/app/**`, `src/views/**` |

## 12. Offene Fragen

- [x] Vokabular vom eigenen Origin bündeln oder zur Laufzeit von Hugging Face laden?
  **Antwort (2026-10-22, autonom entschieden):** Bündeln unter `public/` (≈ 1,5 MB, lazy).
  SPEC-0002 verlangt „keine Anfragen an fremde Origins“, und die Werkbank soll offline vorführbar sein.
- [x] Tokenizer nur als Station im Player oder auch eigenständig?
  **Antwort (2026-10-22, autonom entschieden):** Beides. Die MockEngine nutzt den GPT-2-Tokenizer
  nicht, deshalb wäre er bis SPEC-0006 sonst nirgends zu sehen.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review: geprüfte Tabellen im Konstruktor, Prüfreihenfolge, Virtual Proxy, INV-16 als Glied |
