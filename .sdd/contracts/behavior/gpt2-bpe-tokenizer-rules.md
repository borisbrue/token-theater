# GPT-2-BPE-Tokenizer-Regeln (CON-0008)

Jede Regel nennt ihren Prüfmechanismus (TST-0008 bzw. TST-0009, Vitest, Node). „Referenz“ ist
`.sdd/contracts/behavior/gpt2-bpe-reference.json` (erzeugt mit tiktoken 0.14.0, Kodierung
`gpt2`; Merge-Stufen mit einer Referenz-BPE über dieselben Dateien, gegen tiktoken abgeglichen).
„GPT-2-Tokenizer“ ist der Rückgabewert von `loadGpt2Tokenizer({ baseUrl: '/', fetch })` mit einem
`fetch`, das `public/tokenizers/gpt2/<datei>` aus dem Repo liefert.

## Module und Typen

```ts
// @/engine/tokenizer/byte-level
export const BYTE_TO_UNICODE: readonly string[];           // Index = Byte 0..255
export const UNICODE_TO_BYTE: ReadonlyMap<string, number>;
// @/engine/tokenizer/pretokenize
export const GPT2_PATTERN: RegExp;                          // Flags enthalten g und u
export function pretokenize(text: string): string[];
// @/engine/tokenizer/bpe
export interface BpeTables {
  vocab: ReadonlyMap<string, number>;                       // Symbolfolge im GPT-2-Zeichensatz → ID
  merges: readonly (readonly [string, string])[];          // Index = Rang
}
export class BpeTokenizer implements Tokenizer {
  constructor(tables: BpeTables, options: { eosTokenId: number | null });
  readonly eosTokenId: number | null;
  readonly vocabSize: number;                               // = vocab.size
  encode(text: string): number[];
  tokenize(text: string): Promise<Token[]>;
  decode(tokens: Token[]): string;
  decodeIds(ids: readonly number[]): string;
  tokenBytes(id: number): Uint8Array;
  explain(text: string): BpeDetail;
}
// @/engine/tokenizer/gpt2
export const GPT2_EOS_TOKEN_ID = 50256, GPT2_VOCAB_SIZE = 50257, GPT2_MERGE_COUNT = 50000;
export const GPT2_ASSET_DIR = 'tokenizers/gpt2/';
export class TokenizerLoadError extends Error { readonly kind: 'network' | 'format' } // name 'TokenizerLoadError'
export function parseGpt2Tables(vocabJson: string, mergesTxt: string): BpeTables;
export function loadGpt2Tokenizer(options: {
  baseUrl: string;                                          // endet auf '/'
  fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  signal?: AbortSignal;
}): Promise<BpeTokenizer>;
// @/engine/types – Tokenizer bekommt die optionale Fähigkeit
explain?(text: string): BpeDetail;
```

`BpeDetail` und `BpeWord` stehen in `@/trace/types` (CON-0001 v0.3.0).

## B-01 Byte-Tabelle
*Prüfung: Tabelle gegen die Konstruktionsregel.*

`BYTE_TO_UNICODE` hat 256 Einträge, jeder ist genau ein Zeichen, alle verschieden. Für die Bytes
`0x21–0x7E`, `0xA1–0xAC` und `0xAE–0xFF` ist der Eintrag `String.fromCharCode(b)`. Die übrigen
68 Bytes bekommen in aufsteigender Reihenfolge `U+0100`, `U+0101`, …; also `[32] = 'Ġ'`,
`[10] = 'Ċ'`, `[0] = 'Ā'`. `UNICODE_TO_BYTE` ist die exakte Umkehrung (256 Einträge).

## B-02 Vorzerlegung
*Prüfung: Referenz `pretokenize`.*

`GPT2_PATTERN.source` ist ``'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+``
und die Flags enthalten `g` und `u`. `pretokenize(t)` ist für jeden Referenztext gleich
`pretokens`, und `pretokenize(t).join('') === t`. `pretokenize('')` ist `[]`.

## B-03 IDs wie tiktoken
*Prüfung: Referenz `encode`.*

Für jeden Referenztext ist `encode(text)` gleich `ids` (auch `''` → `[]`). Das gilt für einen
frischen GPT-2-Tokenizer und erneut für denselben Tokenizer nach allen anderen Texten (Cache, B-07).

## B-04 Verlustfreier Round-Trip
*Prüfung: alle Referenztexte.*

`decodeIds(encode(t)) === t` und `decode(await tokenize(t)) === t`. `decode` und `decodeIds`
verketten zuerst die Bytes aller Tokens und dekodieren dann einmal UTF-8 (nicht fatal).

## B-05 Tokens
*Prüfung: alle Referenztexte.*

`tokenize(t)` liefert je ID aus `encode(t)` ein `Token` mit dieser `id` und
`text = new TextDecoder('utf-8').decode(tokenBytes(id))` (nicht fatal, unvollständige Folgen
werden zu U+FFFD). `tokenBytes(id)` sind die Bytes des Vokabulareintrags (GPT-2-Zeichen über
`UNICODE_TO_BYTE` zurückübersetzt), z. B. `tokenBytes(8595)` = `[32, 75, 97, 116]` („ Kat“).

## B-06 explain
*Prüfung: Referenz `explain` (Gleichheit) und alle Referenztexte (Eigenschaften).*

Für die Texte in Referenz `explain` ist `explain(text).words` JSON-tief gleich `words`. Für jeden
Referenztext gilt mit `d = explain(text)`:
- `d.words.map(w => w.text)` ist `pretokenize(text)`; jedes `w.bytes` ist das UTF-8 von `w.text`.
- `w.stages[0]` ist `w.bytes.map(b => [b])`; jede Stufe ergibt verkettet wieder `w.bytes`.
- `w.ranks.length = w.stages.length − 1`; die Ränge sind ganzzahlig und streng steigend.
- Runde `i`: Mit `[a, b] = merges[w.ranks[i]]` (als Bytes) entsteht `w.stages[i+1]` aus
  `w.stages[i]`, indem jedes benachbarte Vorkommen `a, b` von links nach rechts
  (nicht überlappend) zu einem Symbol verschmilzt; mindestens ein Vorkommen existiert. In der
  letzten Stufe hat kein benachbartes Paar eine Merge-Regel.
- `w.ids` sind die IDs der Symbole der letzten Stufe; `d.words.flatMap(w => w.ids)` ist
  `encode(text)`, und die Bytes jedes Endsymbols sind `tokenBytes` seiner ID.
- Ein Pre-Token ohne Merge (z. B. `.`) hat genau eine Stufe und `ranks = []`.

## B-07 Cache ohne Wirkung auf Ergebnisse
*Prüfung: Mini-Tabellen und GPT-2-Tokenizer.*

Zweimaliges `encode`/`explain` desselben Textes liefert gleiche Ergebnisse. Ändert ein Aufrufer
ein zurückgegebenes Array oder `BpeDetail` (z. B. `push`, Element überschreiben), sind spätere
Ergebnisse davon unberührt.

**Mini-Tabellen:** `vocab` enthält alle 256 Zeichen aus `BYTE_TO_UNICODE` mit ID = Byte, dazu
`'ab' → 256` und `'abc' → 257`; `merges = [['a','b'], ['ab','c']]`. Dann gilt
`encode('abcab') = [257, 256]` und `explain('abcab').words[0].ranks = [0, 1]` mit den Stufen
`a b c a b → ab c ab → abc ab`. Der Konstruktor prüft die Tabellen nicht; fehlt ein Symbol der
letzten Stufe im Vokabular, wirft `encode` einen `Error`.

## B-08 Unbekannte IDs
*Prüfung: Ausnahmen.*

`decodeIds([50257])`, `tokenBytes(-1)`, `tokenBytes(1.5)` und `decode([{ id: 99999, text: '' }])`
werfen einen `RangeError`.

## B-09 Spezialtoken und Kennzahlen
*Prüfung: GPT-2-Tokenizer.*

`eosTokenId = 50256`, `vocabSize = 50257`. `encode('<|endoftext|>')` ist der Referenzwert
(sieben IDs), nicht `[50256]`. `decodeIds([50256])` ist `'<|endoftext|>'`.

## B-10 Laden und Prüfen
*Prüfung: `loadGpt2Tokenizer` mit eigenem `fetch`; `parseGpt2Tables` mit veränderten Dateien.*

- `loadGpt2Tokenizer({ baseUrl, fetch, signal })` ruft `fetch` genau zweimal auf, mit
  `${baseUrl}tokenizers/gpt2/vocab.json` und `${baseUrl}tokenizers/gpt2/merges.txt` (für
  `baseUrl` `'/'` und `'/app/'`), und reicht `signal` im zweiten Argument weiter.
- `fetch` lehnt ab oder liefert `ok = false` (z. B. 404) → `TokenizerLoadError` mit
  `kind: 'network'`.
- `parseGpt2Tables` (und damit `loadGpt2Tokenizer`) wirft `TokenizerLoadError` mit
  `kind: 'format'`, wenn: `vocab.json` kein JSON-Objekt ist; ein Wert keine Ganzzahl ist; die
  Anzahl ≠ 50257 ist; eine ID doppelt vorkommt oder außerhalb `0..50256` liegt;
  `'<|endoftext|>'` nicht 50256 ist; die erste Zeile von `merges.txt` nicht mit `#version`
  beginnt; die Zahl der Merge-Zeilen (ohne leere Zeilen am Ende) ≠ 50000 ist; eine Zeile nicht
  aus genau zwei nicht leeren, durch ein Leerzeichen getrennten Teilen besteht; ein Teil oder die
  Verkettung beider Teile nicht im Vokabular steht.
- `\r\n`-Zeilenenden in `merges.txt` werden wie `\n` behandelt.
- Die Originaldateien ergeben einen Tokenizer, der B-03 erfüllt.

## B-11 Assets
*Prüfung: Dateien im Repo.*

| Datei | SHA-256 |
|---|---|
| `public/tokenizers/gpt2/vocab.json` | `196139668be63f3b5d6574427317ae82f612a97c5d1cdaf36ed2256dbf636783` |
| `public/tokenizers/gpt2/merges.txt` | `1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5` |

`public/tokenizers/gpt2/LICENSE` enthält „Modified MIT License“ und „OpenAI“. `.prettierignore`
enthält `public/tokenizers/`. Keine Datei unter `src/` importiert `vocab.json` oder `merges.txt`
(statisch oder dynamisch, auch nicht mit `?raw`/`?url`); die Assets kommen nur über `fetch`.

## B-12 Performance
*Prüfung: Zeitmessung in Vitest (Node).*

`encode` eines Textes aus 10 000 Zeichen (Referenztext „Die Katze schläft auf dem Sofa.“,
wiederholt, mit einem Leerzeichen getrennt, auf 10 000 Zeichen gekürzt) auf einem frisch
geladenen GPT-2-Tokenizer dauert < 500 ms. `parseGpt2Tables` der Originaldateien plus Konstruktion
dauert < 3000 ms.

## B-13 Generator hängt BPE-Details an
*Prüfung: TST-0009 mit einer Test-Engine.*

Hat `engine.tokenizer` die Methode `explain`, enthält die tokenize-Station des erzeugten Traces
`bpe`, JSON-tief gleich `engine.tokenizer.explain(prompt)`; der Trace besteht
`deserializeTrace(serializeTrace(trace))` und INV-16. Ohne `explain` (MockEngine) hat die
tokenize-Station keinen Schlüssel `bpe` (auch nicht nach Serialisierung); die Tests aus TST-0002
bleiben unverändert grün.

**Test-Engine:** `info = { kind: 'test', model: 'gpt2-tokenizer-only', capabilities: ['tokenize',
'logits', 'sample'], architecture: null, eosTokenId: 50256 }`, `tokenizer` = GPT-2-Tokenizer,
`forward` liefert genau eine logits-Station mit
`distribution = [{ token: { id: 1175, text: ' war' }, logit: null, prob: 0.6 },
{ token: { id: 318, text: ' is' }, logit: null, prob: 0.4 }]`, `vocabSize: 50257`, `coverage: null`.
Erzeugt wird mit Prompt „Die Katze schläft auf dem Sofa.“, `maxTokens: 2`, Greedy, Seed 42.
