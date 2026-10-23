---
id: SPEC-0005
title: "Remote adapter for OpenAI-compatible servers"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.2.1
priority: high          # low | medium | high | critical
tags: [engine, remote, ui, milestone-m1]
depends_on: ["SPEC-0001", "SPEC-0002", "SPEC-0004"]
contracts: ["CON-0012", "CON-0013"]
tests: ["TST-0013", "TST-0014"]
fr_test_map:
  FR-01: [TST-0013]
  FR-02: [TST-0013]
  FR-03: [TST-0013]
  FR-04: [TST-0013, TST-0014]
  FR-05: [TST-0013, TST-0014]
  FR-06: [TST-0013]
  FR-07: [TST-0014]
  FR-08: [TST-0014]
  FR-09: [TST-0014]
  FR-10: [TST-0014]
  FR-11: [TST-0014]
---

# Remote adapter for OpenAI-compatible servers

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.0
> Grundlage: `.sdd/docs/architecture/vision.md` (Modus „Echtes Modell“, Meilenstein M1),
> SPEC-0004 (Client-Sampling)

## 1. Kontext & Motivation

Bisher rechnet nur die MockEngine mit 52 Wörtern. Meilenstein M1 heißt „läuft mit echtem
Modell“: Die App fragt einen echten Sprachmodell-Server **Schritt für Schritt nur nach der
Verteilung** des nächsten Tokens (Top-N-Logprobs, `max_tokens: 1`) und zieht das Token selbst
(SPEC-0004). So sieht man bei einem echten Modell, welche Kandidaten es erwägt und wie Temperatur
und Zufall wirken.

Zwei Server stehen bereit und wurden am 2026-10-22 geprüft:

| | mittwald AI Hosting (LiteLLM vor vLLM) | OptiQ-MLX-Server auf dem M1 (LAN) |
|---|---|---|
| Endpunkt | `POST /v1/completions` (Text fortsetzen) | `POST /v1/completions` |
| Logprobs anfordern | `logprobs: N` (Zahl, N ≤ 20) | `logprobs: true` + `top_logprobs: N` (N ≤ 10; 20 und die Zahl-Form brechen die Verbindung ab) |
| Antwort | `logprobs.tokens[]`, `logprobs.top_logprobs[]` als Objekt Token → Logprob, **keine IDs** | `logprobs.content[]` mit `{ id, token, logprob, top_logprobs[] }`, Token-Text im GPT-2-Byte-Zeichensatz (`ĠTisch`) |
| Prompt-Tokens | `echo: true` liefert die Prompt-Tokens (ggf. mit `<s>` vorn) | nicht verfügbar (kein `echo`, kein `/tokenize`, Prompt nur als Text) |
| Auth / CORS | Bearer-Key (geheim), CORS `*` | Bearer `sk-optiq-*` (Pflichtpräfix), CORS `*` |

## 2. Zielsetzung

**Primärziel:** Eine `RemoteEngine` für OpenAI-kompatible Completions-Server in beiden Dialekten,
auswählbar im Formular, mit Client-Sampling, Abbrechen und klaren Fehlermeldungen.

**Erfolgskriterien (messbar):**
- [ ] Mit beiden Dialekten entsteht ein gültiger Trace (Schema + Invarianten), Station für Station abspielbar.
- [ ] Die logits-Station zeigt die Top-N-Kandidaten des Servers, renormiert, mit Abdeckung (`coverage` = Summe der gelieferten Wahrscheinlichkeiten).
- [ ] Temperatur, Top-k, Top-p und Seed aus SPEC-0004 wirken unverändert; gleiche Server-Antworten + gleicher Seed ergeben denselben Trace.
- [ ] Fehler (Netzwerk, 401, 429, kaputte Antwort, keine Logprobs) erscheinen als verständliche Meldung; ein laufender Lauf lässt sich abbrechen.
- [ ] Kein API-Key im Repo oder Bundle; der Key wird nicht dauerhaft im Browser gespeichert.
- [ ] Alle bisherigen Tests bleiben grün; die MockEngine bleibt Default.

**Nicht-Ziele (explizit):**
- Chat-Endpunkt und Chat-Templates (die App setzt Text fort, kein Dialog)
- Eigene Tokenisierung echter Modelle im Browser (Qwen-/Mistral-Vokabular) – Prompt-Tokens nur, wenn der Server sie liefert
- EOS-Erkennung beim Remote-Modell (`eosTokenId = null`, der Lauf endet bei `maxTokens` oder Abbruch)
- Streaming, Parallelisierung, Server-seitiges Sampling
- Proxy-Server oder eigenes Backend (beide Server erlauben CORS)

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/engine/remote/   dialects.ts (RemoteDialect + Registry), token-bytes.ts, token-registry.ts
                     (synthetische IDs, Bytes je ID), distribution.ts (Normalisierung),
                     remote-engine.ts, client.ts (Modelle, Dialekt-Erkennung), errors.ts
src/app/             engine-factory.ts ('remote'), remote-settings.ts (Presets, Normalisierung),
                     Engine-Steuerung im Formular, Abbrechen, Fortschritt
```

Nur `src/app/engine-factory.ts` darf `src/engine/remote` importieren (CON-0004 R-03, die Zone
für konkrete Engines wird um `remote` erweitert). `src/engine/remote` nutzt `fetch` nur über die
injizierte Abhängigkeit und keine Zeit- oder Zufalls-APIs (R-04).

### 3.2 Adapter (Structural): ein Engine-Interface, zwei Dialekte

**Anwendung:** `RemoteEngine` implementiert `InferenceEngine`. Je Schritt sendet `forward` eine
Completions-Anfrage mit dem bisherigen Text und liefert genau eine `logits`-Station. Alles
Dialektwissen steckt in **einem** Objekt je Dialekt (`RemoteDialect`) in einer Registry
(`DIALECTS`); Engine, Erkennung, `DIALECT_MAX_TOP_N` und `info.kind = 'remote-' + id` werden
daraus abgeleitet:

```ts
interface RemoteDialect {
  id: 'legacy' | 'content';
  maxTopN: number;
  canTokenize: boolean;                       // liefert der Server Prompt-Tokens?
  requestFields(topN: number, echo: boolean): Record<string, unknown>;
  readStep(json: unknown): RawCandidate[];    // { key, id: number | null, bytes, logprob }
  readEcho?(json: unknown): RawToken[];       // nur bei canTokenize
  matches(probe: unknown): boolean;           // für detectDialect
}
```

| Dialekt | Anfrage-Felder (immer: `model`, `prompt`, `max_tokens: 1`, `temperature: 1`) | Antwort |
|---|---|---|
| `legacy` | `logprobs: N` (N ≤ 20), beim Tokenisieren zusätzlich `echo: true` | `choices[0].logprobs.top_logprobs[last]` (Objekt) |
| `content` | `logprobs: true`, `top_logprobs: N` (N ≤ 10) | `choices[0].logprobs.content[last].top_logprobs` (Liste mit `id`) |

Dialektübergreifend und unabhängig davon: `token-registry.ts` (synthetische IDs, Bytes je ID) und
`distribution.ts` (Zusammenfassen, Sortieren, Abdeckung; renormiert mit `renormalize` aus
`src/sampling/transform.ts`, SPEC-0004, statt eigener Normierungslogik). Die Byte-Tabelle kommt aus
`src/engine/tokenizer/byte-level.ts` (SPEC-0003). Die Abdeckung zeigt die bestehende
Logits-Ansicht aus SPEC-0004; es gibt keine eigene Remote-Ansicht.

**Begründung:** Generator, Trace, Sampling und Ansichten bleiben unverändert; ein dritter Dialekt
(z. B. llama.cpp) ist ein neuer Registry-Eintrag plus ein Text in `texts.ts`.

Quelle: https://refactoring.guru/design-patterns/adapter

### 3.3 Strategy (Behavioral): Dialekt-Erkennung

`detectDialect(config)` sendet eine Probe im `content`-Format (sie ist für beide Server sicher;
die Zahl-Form würde den MLX-Server abbrechen lassen) und entscheidet am Antwortformat:
`logprobs.content` → `content`, `logprobs.tokens` → `legacy`, sonst Fehler „Der Server liefert
keine Logprobs“. Die Einstellung „Automatisch“ nutzt das Ergebnis; Presets können den Dialekt
fest vorgeben.

Quelle: https://refactoring.guru/design-patterns/strategy

### 3.4 Tokens, IDs und Text

- **Bytes je Token:** `content`: Token-Text über die GPT-2-Byte-Tabelle (SPEC-0003,
  `UNICODE_TO_BYTE`) in Bytes; Zeichen außerhalb der Tabelle → UTF-8 des Zeichens. `legacy`: UTF-8
  des Token-Strings; die vLLM-Form `bytes:\xNN…` ergibt die genannten Bytes.
- **Text:** `Token.text` = UTF-8-Dekodierung der Bytes mit Ersatzzeichen. Der nächste Prompt ist
  die Dekodierung **aller** Bytes des Kontexts am Stück (halbe UTF-8-Folgen bleiben heil).
- **IDs:** `content` liefert echte IDs. `legacy` liefert keine: Die Engine vergibt je Lauf
  synthetische IDs ab 0 in Reihenfolge des ersten Auftretens eines Token-Strings (stabil im
  Trace). `engine.info.kind` ist `'remote-legacy'` bzw. `'remote-content'`, `engine.info.model`
  der Modellname.
- **Prompt-Tokens (`tokenize`):** `legacy`: Anfrage mit `echo: true`. Die echoten Tokens ohne das
  letzte (das neu erzeugte) heißen `E`. Prompt-Tokens sind `E[k..]` mit dem kleinsten `k`, für das
  die Verkettung von `E[k..]` genau den Prompt ergibt (so fallen führende Spezialtokens wie `<s>`
  weg); gibt es kein solches `k`, ist das ein `format`-Fehler. Leere Token-Strings (vLLM bei halben
  UTF-8-Folgen, das abschließende Token trägt dann das ganze Zeichen) bleiben als Tokens mit
  leerem Text erhalten. Fähigkeiten `tokenize, logits, sample`. `content`: kein Tokenisieren
  möglich; der Prompt ist **ein** Kontext-Token `{ id: PROMPT_TOKEN_ID, text: prompt }` mit der
  reservierten ID `PROMPT_TOKEN_ID = 2147483647` (2³¹ − 1; größer als jedes Vokabular echter
  Modelle, kollidiert also mit keiner echten ID), Fähigkeiten `logits, sample`.
- **Verteilung:** `prob_i = exp(logprob_i) / Σ exp(logprob)`, `logit: null`, absteigend sortiert
  (Gleichstand: ID aufsteigend), doppelte IDs zusammengefasst (Summe), `coverage = Σ exp(logprob)`
  (≤ 1, auf 1 begrenzt), `vocabSize: null`.
- `info.architecture = null`, `info.eosTokenId = null`.

### 3.5 Fehler

`RemoteError` mit `kind` und deutscher Meldung (sie landet über das `error`-Event im Trace und in
der Oberfläche). Die Meldung steht bewusst in der Engine und nicht in `texts.ts`: Der Trace führt
sie als Grund mit, und ein exportierter Trace soll ihn auch ohne die App lesbar zeigen (CON-0001
erlaubt beliebige Meldungstexte). Die Oberfläche setzt nur den Rahmen („Der Lauf wurde
abgebrochen: …“) aus `texts.ts` davor.

| kind | Auslöser | Meldung |
|---|---|---|
| `network` | `fetch` lehnt ab (Netz, CORS, DNS) | „Der Server ist nicht erreichbar (<url>).“ |
| `auth` | HTTP 401/403 | „Der Server hat den API-Key abgelehnt (HTTP <status>).“ |
| `rate-limit` | HTTP 429 | „Der Server begrenzt die Anfragen (HTTP 429). Bitte kurz warten.“ |
| `http` | sonstiger Status ≠ 2xx | „Der Server antwortete mit HTTP <status>.“ |
| `format` | kein JSON, unerwartete Struktur | „Die Antwort des Servers hat ein unerwartetes Format.“ |
| `no-logprobs` | Antwort ohne Logprobs | „Der Server liefert keine Logprobs.“ |

Ein abgebrochenes `signal` erzeugt keinen `RemoteError`; der Generator beendet den Lauf mit
`aborted` (CON-0002).

### 3.6 Factory Method (Creational) und Einstellungen

`createEngine('remote', deps, { remote: config })` baut die `RemoteEngine`
(`config = { baseUrl, apiKey, model, dialect, topN }`). `src/app/remote-settings.ts` liefert die
**Presets** aus `import.meta.env.VITE_REMOTE_PRESETS` (JSON-Liste `{ name, baseUrl, model?,
apiKey?, dialect? }`, aus der gitignorierten `.env.local`), normalisiert die Basis-URL (ohne
abschließenden `/`) und `topN` (1 bis zum Dialekt-Maximum, Default = Maximum). Ungültiges
`VITE_REMOTE_PRESETS` ergibt eine leere Liste.

Quelle: https://refactoring.guru/design-patterns/factory-method

### 3.7 Oberfläche

Im Formular der Ansicht „Durchlauf“ steht vor „Sampling“ eine Gruppe „Engine“:
- Radio „Mock“ (Default) und „Server“.
- Bei „Server“: Auswahl „Profil“ (Presets und „Eigene Angaben“), Felder „Basis-URL“, „API-Key“
  (Passwortfeld), „Modell“ (Textfeld mit Vorschlagsliste), Auswahl „Dialekt“ („Automatisch“,
  „Klassisch (vLLM)“, „Logprobs-Liste (MLX)“), Knopf „Modelle laden“ mit Statustext
  „n Modelle gefunden“ bzw. Fehlermeldung.
- Ein Profil füllt Basis-URL, Modell, Dialekt und – falls im Preset – den Key.
- Während ein Server-Lauf läuft: Text „Schritt i von n“ und Knopf „Abbrechen“. Der Fortschritt
  kommt aus dem Event-Strom des Generators (`step-start`), den `generateTrace` an einen Beobachter
  der App meldet (Observer); Engine und Generator bekommen keinen UI-Callback. Abbrechen läuft über
  ein `AbortSignal`. „Abbrechen“ beendet nur die Rechenphase (das Erzeugen); das Anhalten der
  Wiedergabe bleibt Sache der Transportleiste aus SPEC-0002 („Pause“).
- Endet ein Lauf mit `error`, erscheint die Meldung als `alert` („Der Lauf wurde abgebrochen:
  <Meldung>“); erzeugte Schritte bleiben abspielbar.
- Basis-URL, Modell, Dialekt und Profil merkt sich der Browser (localStorage, Fehler beim Zugriff
  werden ignoriert); der API-Key **nie**.

### 3.8 Festlegungen für die test-first geschriebenen Tests

- **Module:** `@/engine/remote/remote-engine` exportiert `RemoteEngine`, `RemoteConfig`,
  `PROMPT_TOKEN_ID`, `DIALECT_MAX_TOP_N` (`{ legacy: 20, content: 10 }`, aus der Registry);
  `@/engine/remote/dialects` exportiert `DIALECTS` und den Typ `RemoteDialect`;
  `@/engine/remote/errors` exportiert `RemoteError`; `@/engine/remote/client` exportiert
  `listModels(connection: { baseUrl, apiKey }, deps?)` und
  `detectDialect(target: { baseUrl, apiKey, model }, deps?)`; `@/engine/remote/token-bytes`
  exportiert `legacyTokenBytes`, `contentTokenBytes`. `RemoteEngine`, `listModels` und
  `detectDialect` bekommen `{ fetch }` als Abhängigkeit (Default: globales `fetch`).
- **DOM:** `group` „Engine“ mit `radio` „Mock“/„Server“, `combobox` „Profil“, `textbox`
  „Basis-URL“, Passwortfeld mit Label „API-Key“, `textbox`/`combobox` „Modell“, `combobox`
  „Dialekt“, `button` „Modelle laden“, `button` „Abbrechen“ (nur während eines Server-Laufs).
- **E2E-Server:** Playwright fängt `**/fake-llm/v1/**` per `page.route` ab (eigener Origin,
  CON-0003 UI-04 bleibt erfüllt).

## 4. Funktionale Anforderungen

- **FR-01:** `src/engine/remote/` implementiert `RemoteEngine` (InferenceEngine) nach 3.2 und 3.4: je Schritt eine Completions-Anfrage mit `Authorization: Bearer <key>` und den Feldern des Dialekts, Ergebnis genau eine logits-Station.
- **FR-02:** Die Dialekte `legacy` und `content` lesen die Antworten nach 3.4 (Bytes, Text, IDs, Verteilung, Abdeckung); `topN` wird auf das Dialekt-Maximum begrenzt.
- **FR-03:** Der Tokenizer der RemoteEngine liefert bei `legacy` die Prompt-Tokens per `echo`, bei `content` ein einzelnes Prompt-Token; `decode` dekodiert die verketteten Bytes.
- **FR-04:** Fehler werden nach 3.5 als `RemoteError` gemeldet; ein abgebrochenes Signal bricht die laufende Anfrage ab. Der Generator wertet einen Fehler aus `forward`, der nach dem Abbruch des Signals auftritt, als `done(aborted)` statt `error` (CON-0002 sieht für Abbrüche `aborted` vor).
- **FR-05:** `listModels(config)` liest `GET /models`; `detectDialect(config)` erkennt den Dialekt nach 3.3.
- **FR-06:** `createEngine('remote', …)` baut die RemoteEngine; die ESLint-Zone für konkrete Engines umfasst `src/engine/remote`.
- **FR-07:** `src/app/remote-settings.ts` liest Presets aus `VITE_REMOTE_PRESETS` und normalisiert Einstellungen nach 3.6; `.env.local` ist gitignoriert, im Repo liegt `.env.example` ohne Geheimnisse.
- **FR-08:** Die Engine-Steuerung im Formular nach 3.7 (Mock/Server, Profil, Felder, Modelle laden, Dialekt).
- **FR-09:** Server-Läufe zeigen Fortschritt und lassen sich abbrechen; Fehler-Läufe zeigen die Meldung, ihre Schritte bleiben abspielbar.
- **FR-10:** Der API-Key wird nicht in localStorage, sessionStorage, URL oder Trace geschrieben; übrige Server-Einstellungen werden lokal gemerkt.
- **FR-11:** Alle neuen Texte in `src/app/texts.ts`; bestehende Contracts (CON-0003, CON-0006, CON-0009, CON-0011) bleiben erfüllt.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                    | um ...                                                    |
|-------|----------------|-------------------------------------------------------------------|-----------------------------------------------------------|
| US-01 | Vortragende/r  | den Prompt an ein echtes Modell schicken und die Kandidaten sehen | zu zeigen, dass ein echtes Modell genauso Wahrscheinlichkeiten ausgibt |
| US-02 | Lernende/r     | Temperatur und Seed beim echten Modell verändern                  | den Zufall an einem echten Modell nachzuvollziehen       |
| US-03 | Vortragende/r  | zwischen lokalem Server und Cloud-Server wählen                   | auch ohne Internet (LAN) oder ohne eigene Hardware vorzuführen |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Sicherheit      | Kein Key im Repo/Bundle; Key nur im Speicher der Seite; `.env.local` gitignoriert |
| Robustheit      | Jede Antwort wird geprüft, bevor sie in den Trace geht; Fehler brechen sauber ab (INV-12 `error`) |
| Determinismus   | Bei gleichen Server-Antworten und gleichem Seed bytegleicher Trace (feste `idProvider`/`clock`) |
| Last            | Anfragen strikt nacheinander (mittwald: 60 Anfragen/min) |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: Echtes Modell

  Scenario: Lauf gegen einen vLLM-artigen Server
    Given ein Server im Dialekt "legacy" mit Top-5-Logprobs
    When ich "Server" wähle und "die katze sitzt" mit 3 Tokens erzeuge
    Then hat Schritt 0 die Stationen "tokenize, logits, sample"
    And zeigt die logits-Station 5 Kandidaten und ihre Abdeckung

  Scenario: Falscher Key
    Given der Server antwortet mit 401
    When ich erzeuge
    Then sehe ich "Der Server hat den API-Key abgelehnt (HTTP 401)."
```

Die verbindlichen Szenarien stehen in den Contracts (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Server liefert weniger Kandidaten als angefordert: Verteilung mit den gelieferten.
- Gleicher Token-Text unter zwei IDs (`content`): beide bleiben (verschiedene IDs); gleiche ID doppelt: zusammengefasst.
- Antwort-Logprob `-Infinity`/`null` für einen Kandidaten: Kandidat entfällt.
- `echo` liefert `<s>` oder andere Spezialtokens vorn: entfallen.
- Token-Text mit halbem UTF-8 (`bytes:\xe4` bzw. Byte-Zeichen): Text mit U+FFFD, Prompt bleibt korrekt.
- Abbruch während einer Anfrage: Trace mit `aborted`, kein Fehler-Alert.
- 429 mitten im Lauf: Lauf endet mit `error`, die bis dahin erzeugten Schritte bleiben.
- Leere Modellliste: „0 Modelle gefunden“.

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0012 | behavior (markdown) | RemoteEngine: Anfragen, Dialekte, Tokens/IDs/Bytes, Verteilung, Fehler, Abbruch, Client, Factory, Schichtregel |
| CON-0013 | behavior (gherkin)  | Engine-Steuerung, Server-Läufe, Fortschritt, Abbrechen, Fehlermeldungen, Key-Umgang |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0013 | unit       | CON-0012 mit einem fetch-Double, das aufgezeichnete Antworten beider Server liefert |
| TST-0014 | acceptance | CON-0013 mit `page.route` als Fake-Server in beiden Dialekten |

## 11. Implementierungsreihenfolge

Genau zwei Tasks, je einer pro vorhandener (committeter) Testsuite. Fixtures unter `tests/fixtures/`
liegen bereits vor.

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | RemoteEngine, Dialekte, Tokenizer, Fehler, Client, Factory, ESLint-Zone, Abbruch im Generator | FR-01–FR-06 | `tests/unit/remote-engine.test.ts` | `src/engine/remote/**`, `src/engine/generate.ts`, `src/app/engine-factory.ts`, `eslint.config.js` |
| 2 | Einstellungen, Engine-Steuerung, Fortschritt, Abbrechen, Fehleranzeige | FR-07–FR-11 | `tests/e2e/remote.spec.ts` | `src/app/**`, `src/views/**`, `.env.example`, `.gitignore` |

## 12. Offene Fragen

- [x] Proxy nötig? **Antwort (2026-10-22, geprüft):** Nein, beide Server senden `Access-Control-Allow-Origin: *`.
- [x] Chat- oder Completions-Endpunkt? **Antwort (2026-10-22, autonom entschieden):** Completions; die App setzt Text fort, Chat-Templates würden die Verteilung verfälschen und bei Qwen den Denkmodus auslösen.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review: Dialekt-Registry (OCP), PROMPT_TOKEN_ID statt 0 (LSP), schmale Client-Signaturen mit fetch-Injektion (ISP/DIP), token-registry/distribution getrennt (SRP) |
| 2026-10-22 | 0.2.1   | Boris  | Nachtrag aus SPEC-0009: Der Tokenstrom zeigt Leerraum sichtbar (CON-0013 v0.2.0, Server-Prompt „Die␣Katze␣sitzt␣auf␣dem“); Server-Läufe bekommen einen Hinweis auf fehlende Interna |
