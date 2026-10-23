# RemoteEngine-Regeln (CON-0012)

Jede Regel nennt ihren Prüfmechanismus (TST-0013, Vitest, Node). Grundlage sind aufgezeichnete
Antworten echter Server unter `tests/fixtures/remote/` (2026-10-22; `legacy-*` von mittwald/vLLM,
Modelle `Qwen3.5-0.8B` und `Ministral-3-14B-Instruct-2512`; `content-*` vom OptiQ-MLX-Server,
`Qwen3.5-35B-A3B-OptiQ-4bit`). Ein **fetch-Double** zeichnet jede Anfrage auf (URL, Methode,
Header, JSON-Body, Signal) und antwortet mit einer Fixture oder einem vorgegebenen Status.
Zahlen gelten mit ±1e-6. `config = { baseUrl: 'https://llm.example/v1', apiKey: 'sk-test-123',
model: 'm', dialect, topN }`.

## Module und Typen

```ts
// @/engine/remote/remote-engine
export type Dialect = 'legacy' | 'content';
export const DIALECT_MAX_TOP_N: Readonly<Record<Dialect, number>>;   // { legacy: 20, content: 10 }, aus DIALECTS
export const PROMPT_TOKEN_ID = 2147483647;                           // Kontext-Token ohne Vokabular-ID
export interface RemoteConfig { baseUrl: string; apiKey: string; model: string; dialect: Dialect; topN: number }
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export class RemoteEngine implements InferenceEngine {
  constructor(config: RemoteConfig, deps?: { fetch?: FetchLike });
}
// @/engine/remote/dialects – die Registry, aus der Engine und Erkennung alles Dialektwissen beziehen
export const DIALECTS: readonly RemoteDialect[];                      // ids in dieser Reihenfolge: 'legacy', 'content'
// @/engine/remote/errors
export type RemoteErrorKind = 'network' | 'auth' | 'rate-limit' | 'http' | 'format' | 'no-logprobs';
export class RemoteError extends Error { readonly kind: RemoteErrorKind }   // name 'RemoteError'
// @/engine/remote/client
export function listModels(config: Omit<RemoteConfig, 'model' | 'dialect' | 'topN'>, deps?: { fetch?: FetchLike }): Promise<string[]>;
export function detectDialect(config: Omit<RemoteConfig, 'dialect' | 'topN'>, deps?: { fetch?: FetchLike }): Promise<Dialect>;
// @/engine/remote/token-bytes
export function contentTokenBytes(token: string): number[];
export function legacyTokenBytes(token: string): number[];
```

## RE-01 Anfrage im Dialekt `legacy`
*Prüfung: aufgezeichnete Anfrage von `forward`.*

`POST ${baseUrl}/completions` mit den Headern `Authorization: Bearer <apiKey>` und
`Content-Type: application/json`. Der Body ist genau
`{ model, prompt, max_tokens: 1, temperature: 1, logprobs: N }`; beim Tokenisieren (RE-07)
zusätzlich `echo: true`. Das `signal` aus `forward` wird an `fetch` weitergereicht.

## RE-02 Anfrage im Dialekt `content`
*Prüfung: wie RE-01.*

Body genau `{ model, prompt, max_tokens: 1, temperature: 1, logprobs: true, top_logprobs: N }`;
nie `echo`, nie eine Zahl in `logprobs`.

## RE-03 Top-N
*Prüfung: Body bei verschiedenen `topN`.*

`N = topN`, wenn `topN` eine Ganzzahl in `1..DIALECT_MAX_TOP_N[dialect]` ist, sonst das Maximum
(z. B. `legacy`: 5 → 5, 50 → 20, 0 → 20; `content`: 20 → 10, 2.5 → 10).

## RE-04 Verteilung im Dialekt `legacy`
*Prüfung: logits-Station aus `legacy-step.json` (N = 5) und `legacy-echo.json`.*

Gelesen wird `choices[0].logprobs.top_logprobs` am letzten Index (Objekt Token → Logprob). Es
bleiben die `N` Einträge mit den größten Logprobs; Einträge mit nicht endlichem Logprob entfallen.
`prob_i = exp(lp_i) / Σ exp(lp)`, `logit: null`, `coverage = min(1, Σ exp(lp))`,
`vocabSize: null`. `legacy-step.json` ergibt die Texte `' Sofa', ' Boden', ' Dach', ' Tisch',
' Bett'` mit `prob` 0.558678, 0.205526, 0.103345, 0.080485, 0.051965 und `coverage` 0.436663.
In `legacy-echo.json` enthält das Objekt sechs Einträge (zusätzlich das vom Server gezogene
`' Nest'`); bei N = 5 entfällt `' Nest'`.

**Synthetische IDs:** Eine Engine-Instanz vergibt IDs ab 0 an Token-Strings in der Reihenfolge,
in der sie zum ersten Mal erscheinen: zuerst die Prompt-Tokens (RE-07), dann je Schritt die neuen
Strings der Verteilung in absteigender Wahrscheinlichkeit. Danach ist die Verteilung absteigend
nach `prob` und bei Gleichstand aufsteigend nach `id` sortiert (CON-0001 INV-10). Derselbe String
hat in einem Lauf immer dieselbe ID.

## RE-05 Verteilung im Dialekt `content`
*Prüfung: `content-step.json`, `content-step-2.json` und konstruierte Antworten.*

Gelesen wird `choices[0].logprobs.content[last].top_logprobs` (Liste `{ id, token, logprob }`);
Rechnung wie RE-04, aber mit den echten IDs; der Text kommt aus den Bytes (RE-06).
`content-step.json` ergibt die IDs `181299, 182765, 58798, 769, 79383`, die Texte `' Dach',
' Tisch', ' Sofa', ' St', ' Baum'`, `prob` 0.280760, 0.280760, 0.181272, 0.132622, 0.124586 und
`coverage` 0.618941 (Gleichstand Dach/Tisch: kleinere ID zuerst). Dieselbe ID doppelt wird
zusammengefasst (Wahrscheinlichkeiten addiert). Ohne verwertbare Kandidaten → `no-logprobs`.

## RE-06 Token-Bytes und Text
*Prüfung: Funktionsaufrufe.*

- `contentTokenBytes('ĠDach') = [32, 68, 97, 99, 104]`, `contentTokenBytes('Ã¤') = [195, 164]`,
  `contentTokenBytes('ðŁ¦Ĭ') = [240, 159, 166, 138]`; Zeichen außerhalb der GPT-2-Byte-Tabelle
  werden UTF-8: `contentTokenBytes('中') = [228, 184, 173]`.
- `legacyTokenBytes(' Sofa')` = UTF-8 von `' Sofa'`; `legacyTokenBytes('bytes:\xe4\xb8')`
  (wörtlich mit Backslashes) = `[228, 184]`; `legacyTokenBytes('') = []`.
- `Token.text` = `new TextDecoder('utf-8').decode(bytes)` (nicht fatal).

## RE-07 Tokenizer
*Prüfung: `engine.tokenizer` mit fetch-Double.*

- `legacy`: `tokenize(prompt)` sendet eine Anfrage nach RE-01 mit `echo: true`. Die echoten Tokens
  ohne das letzte heißen `E`; Ergebnis ist `E[k..]` mit dem kleinsten `k`, dessen Verkettung genau
  `prompt` ergibt. `legacy-echo.json` mit „Die Katze sitzt auf dem“ → Texte `Die, ␣Kat, ze,
  ␣sitzt, ␣auf, ␣dem` (␣ = Leerzeichen) mit IDs 0–5. `legacy-echo-bos.json` mit „Die Katze“ →
  `Die, ␣Kat, ze` (ohne `<s>`). `legacy-echo-emoji.json` mit „Ein Fuchs 🦊 und“ → `Ein, ␣F, uchs,
  (leer), (leer), ␣🦊, ␣und`. Passt keine Verkettung zum Prompt → `RemoteError('format')`.
- `content`: `tokenize(prompt)` sendet **keine** Anfrage und liefert
  `[{ id: PROMPT_TOKEN_ID, text: prompt }]`.
- `decode(tokens)` verkettet die Bytes und dekodiert einmal: Die Bytes eines Tokens kennt die
  Engine je ID aus Echo und Antworten (`PROMPT_TOKEN_ID`: UTF-8 seines Textes; unbekannte ID:
  UTF-8 von `text`).
- `eosTokenId = null`.

## RE-08 Kontext als Prompt
*Prüfung: Body der Folgeanfragen.*

`forward(context)` sendet `prompt = tokenizer.decode(context)`. Beispiel `content`: Kontext
`[Prompt „Die Katze sitzt auf dem“, Token 181299]` → `prompt` „Die Katze sitzt auf dem Dach“.
Halbe UTF-8-Folgen über Tokengrenzen hinweg: Kontext `[Prompt „Ein Fuchs “, Token A (Text
`ðŁ`), Token B (Text `¦Ĭ`)]`, deren Bytes die Engine aus vorherigen Antworten kennt → `prompt`
„Ein Fuchs 🦊“.

## RE-09 Fehler
*Prüfung: fetch-Double mit Status bzw. Ablehnung; direkt und über `generate`.*

| Antwort | `kind` | `message` |
|---|---|---|
| `fetch` lehnt ab (`TypeError`) | `network` | `Der Server ist nicht erreichbar (https://llm.example/v1).` |
| HTTP 401 / 403 | `auth` | `Der Server hat den API-Key abgelehnt (HTTP 401).` bzw. `(HTTP 403).` |
| HTTP 429 | `rate-limit` | `Der Server begrenzt die Anfragen (HTTP 429). Bitte kurz warten.` |
| HTTP 500 | `http` | `Der Server antwortete mit HTTP 500.` |
| Body kein JSON / ohne `choices` | `format` | `Die Antwort des Servers hat ein unerwartetes Format.` |
| `choices[0].logprobs` fehlt oder `null` | `no-logprobs` | `Der Server liefert keine Logprobs.` |

`RemoteError` ist ein `Error` mit `name = 'RemoteError'`. Über `generate` endet der Lauf mit dem
`error`-Event dieser Meldung; der Trace hat `finishReason: 'error'` und `error.message` = Meldung.

## RE-10 Abbruch
*Prüfung: `AbortController`, fetch-Double, das bis zum Abbruch wartet.*

Wird das Signal während einer Anfrage abgebrochen, endet `generate` mit `done(aborted)` (kein
`error`), und `fetch` hat das Signal erhalten. Dafür wertet `generate` jeden Fehler aus `forward`,
der bei bereits abgebrochenem Signal auftritt, als Abbruch. Ein vor dem Lauf abgebrochenes Signal führt zu
keiner Anfrage für `forward`.

## RE-11 Client
*Prüfung: `listModels`, `detectDialect` mit fetch-Double.*

- `listModels` sendet `GET ${baseUrl}/models` mit dem Authorization-Header und liefert
  `data[].id` in Antwortreihenfolge (`models-legacy.json`: 12 IDs, erste `'gpt-oss-120b'`;
  `models-content.json`: 11 IDs). Fehler wie RE-09.
- `detectDialect` sendet eine Anfrage nach RE-02 (Body `logprobs: true`, `top_logprobs: 1`,
  Prompt `'Hallo'`) und liefert `'content'` bei `logprobs.content`, `'legacy'` bei
  `logprobs.tokens`; sonst `RemoteError('no-logprobs')`.

## RE-12 Läufe über den Generator
*Prüfung: `generate` + `TraceRecorder` (feste `idProvider`/`clock`) mit fetch-Double.*

- `legacy`, Prompt „Die Katze sitzt auf dem“, `maxTokens` 3, Greedy, N = 5; das Double antwortet
  auf `echo` mit `legacy-echo.json`, sonst mit `legacy-step.json`: 4 Anfragen in dieser
  Reihenfolge (Echo, dann je Schritt eine); `engine.info = { kind: 'remote-legacy', model: 'm',
  capabilities: ['tokenize', 'logits', 'sample'], architecture: null, eosTokenId: null }`;
  Schritt 0 hat die Stationen `tokenize, logits, sample`, die übrigen `logits, sample`; die
  zweite Schritt-Anfrage hat `prompt` „Die Katze sitzt auf dem Sofa“; der Trace besteht Schema und
  Invarianten, `finishReason: 'max-tokens'`.
- `content`, gleicher Prompt, `maxTokens` 3, Greedy, Antworten `content-step.json`: 3 Anfragen;
  `kind: 'remote-content'`, `capabilities: ['logits', 'sample']`; `steps[0].contextTokens =
  [{ id: PROMPT_TOKEN_ID, text: prompt }]`; zweite Anfrage mit `prompt` „Die Katze sitzt auf dem Dach“; Schema
  und Invarianten erfüllt.
- Zwei Läufe mit `StochasticSampler({ temperature: 1, topK: 0, topP: 1 })`, Seed 7 und gleichen
  Antworten ergeben bytegleiche Traces.
- Der serialisierte Trace enthält den API-Key nicht.

## RE-13a Dialekt-Registry
*Prüfung: `DIALECTS`.*

`DIALECTS.map(d => d.id)` ist `['legacy', 'content']`; `DIALECT_MAX_TOP_N[d.id] = d.maxTopN`;
`legacy.canTokenize = true`, `content.canTokenize = false`; `d.matches` erkennt die eigene Fixture
(`legacy-step.json` bzw. `content-step.json`) und nicht die des anderen Dialekts.

## RE-13 Factory und Schichtregel
*Prüfung: `createEngine`, ESLint-Node-API (wie CON-0004).*

- `createEngine('remote', deps, { remote: config })` liefert eine `RemoteEngine` mit
  `info.model = config.model`; ohne `options.remote` wirft es einen `Error`.
- `src/app/App.tsx` mit Wert-Import aus `'../engine/remote/remote-engine'` → 
  `import-x/no-restricted-paths` (Severity 2); `src/app/engine-factory.ts` mit demselben Import
  (Pfad `'./../engine/remote/remote-engine'` bzw. `'../engine/remote/remote-engine'`) → keine Meldung
  dieser Regel; `src/engine/generate-x.ts` mit Import aus `'./remote/remote-engine'` →
  `import-x/no-restricted-paths`.
- `src/engine/remote/**` erfüllt CON-0004 R-02 bis R-04 (kein `any`, kein React, aus `src/trace`
  nur Typen, kein Zufall/keine Zeit).
