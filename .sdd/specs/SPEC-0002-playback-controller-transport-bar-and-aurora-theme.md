---
id: SPEC-0002
title: "Playback controller, transport bar and Aurora theme"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-21
updated: 2026-10-21
version: 0.2.0
priority: high          # low | medium | high | critical
tags: [playback, ui, theme, accessibility]
depends_on: ["SPEC-0001"]
contracts: ["CON-0005", "CON-0006", "CON-0007"]
tests: ["TST-0005", "TST-0006", "TST-0007"]
fr_test_map:
  FR-01: [TST-0005]
  FR-02: [TST-0005]
  FR-03: [TST-0005, TST-0006]
  FR-04: [TST-0005, TST-0006]
  FR-05: [TST-0005, TST-0006]
  FR-06: [TST-0005, TST-0006]
  FR-07: [TST-0005]
  FR-08: [TST-0006]
  FR-09: [TST-0006]
  FR-10: [TST-0006, TST-0005]
  FR-11: [TST-0006]
  FR-12: [TST-0006]
  FR-13: [TST-0006]
  FR-14: [TST-0007, TST-0006]
  FR-15: [TST-0006, TST-0007]
---

# Playback controller, transport bar and Aurora theme

> **Status:** draft · **Owner:** Boris · **Version:** 0.2.0
> Grundlage: `.sdd/docs/architecture/vision.md`, ADR-0001 (Aurora), Mockup „Player (SPEC-0002)“
> auf der Design-Leinwand https://claude.ai/artifact/JS7xoqJEvzD21aimVtLKjs

## 1. Kontext & Motivation

SPEC-0001 liefert Traces: jeder Schritt mit seinen Stationen, vollständig aufgezeichnet. Bisher
sieht man sie nur als statische Liste. Das Leitprinzip „erst rechnen, dann abspielen“ braucht
jetzt den **Abspieler**: einen Cursor, der Station für Station durch den Trace läuft – automatisch
im gewählten Tempo oder Schritt für Schritt per Taste –, und eine Oberfläche, die zeigt, wo man
gerade ist. Für Vortragende ist das die Fernbedienung, für Lernende das Zurückspulen.

Gleichzeitig führt diese Spec die Designsprache „Aurora“ (ADR-0001) ein: Ab hier entstehen echte
Ansichten, und sie sollen von Anfang an im endgültigen Look entstehen.

## 2. Zielsetzung

**Primärziel:** Ein getesteter, UI-unabhängiger Playback-Controller plus Transportleiste,
Zeitleiste, Stationsleiste, Tokenstrom und Stationsansicht im Aurora-Theme, bedienbar per Maus
und Tastatur.

**Erfolgskriterien (messbar):**
- [ ] Der Controller läuft vollständig ohne React und ohne echte Zeit (injizierbarer Scheduler); alle Szenarien aus CON-0005 sind grün.
- [ ] Ein erzeugter oder importierter Trace lässt sich abspielen, pausieren, stationsweise und schrittweise vor- und zurückspulen; die Anzeige folgt dem Cursor (CON-0006).
- [ ] Alle Bedienungen sind auch per Tastatur erreichbar (Leertaste, Pfeile, Shift+Pfeile, Pos1/Ende).
- [ ] Alle Text-/Grund-Paare des Themes erreichen mindestens 4.5:1 (automatisch geprüft, CON-0007).
- [ ] Die Seite lädt weiterhin keine Ressourcen von fremden Origins (Schriften gebündelt).
- [ ] Alle Tests aus SPEC-0001 (TST-0001 bis TST-0004 sowie Scaffold) bleiben grün.

**Nicht-Ziele (explizit):**
- Visualisierungen einzelner Stationen (Heatmap, Logit-Balken, Embedding-Ansicht) → SPEC-0004/0007; die Stationsansicht zeigt hier Titel, Erklärtext und Tensorformen
- Sampling-Regler (Temperatur, Top-p) → SPEC-0004
- Präsentationsmodus, geführte Tour, Vollbild → SPEC-0008
- Live-Abspielen während der Erzeugung (Streaming) – der Trace ist beim Abspielen immer vollständig
- Hell-Modus (ADR-0001: nur Dark Mode)
- Persistenz des Cursors (URL, Storage)

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/app/        App-Shell, Inspector-Steuerung (aus SPEC-0001), Theme (src/app/theme/), Tastatur-Hook
src/views/      transport/ (TransportBar, StepTimeline, StationStrip), token-stream/, station/  – nur Props
src/playback/   controller.ts (ohne React), frames.ts, scheduler.ts, durations.ts, store.ts (Zustand)
src/trace/      unverändert (nur Typen werden gelesen)
```

`src/playback/**` importiert nur Typen aus `src/trace/` und nie React außer in `store.ts`
(Zustand-Hook). Views bekommen Zustand und Callbacks als Props und kennen den Controller nicht;
die App verdrahtet beides. Die bestehenden Schichtregeln (CON-0004 R-03) gelten unverändert.

### 3.2 Frame-Modell

Ein Trace wird zu einer flachen Liste von **Frames** abgeflacht: ein Frame je Station
(`{ step, station }` in Trace-Reihenfolge). Der **Cursor** ist ein Index in diese Liste. Ein Trace
mit 0 Schritten hat 0 Frames und keinen Cursor (`null`).

```ts
interface Frame { step: number; station: number }
interface PlaybackState {
  trace: Trace | null;
  frames: readonly Frame[];
  cursor: number | null;          // null ⇔ frames leer
  mode: 'idle' | 'paused' | 'playing';
  speed: Speed;                   // 0.25 | 0.5 | 1 | 2
}
// playing ≡ mode === 'playing'; verbindliche API in CON-0005
```

Abgeleitete Werte (reine Funktionen in `frames.ts`): aktueller Schritt und aktuelle Station,
Position „Station i von n“ im Schritt, Gesamtfortschritt, **sichtbare Tokens** (Kontext des
aktuellen Schritts; ab der `sample`-Station zusätzlich das gewählte Token, markiert als neu).

### 3.3 State Pattern (Behavioral): Wiedergabezustände

**Anwendung:** Der Controller hat drei Zustände: `idle` (kein Trace oder 0 Frames), `paused`,
`playing`. Jeder Befehl (`play`, `pause`, `toggle`, `next`, `prev`, `nextStep`, `prevStep`,
`first`, `last`, `seek`, `setSpeed`, `load`) ist je Zustand definiert, z. B. `play` im Zustand
`paused` am letzten Frame springt zuerst an den Anfang (Wiederholen), `play` in `idle` tut nichts.
Manuelle Navigation während `playing` hält die Wiedergabe an (Vortragende übernehmen die Kontrolle).

**Begründung:** Die Regeln sind klein, aber zahlreich; als Zustandstabelle sind sie vollständig
testbar (CON-0005) und widerspruchsfrei.

**Alternative:** Verstreute Boolean-Flags (`isPlaying`, `isAtEnd`, …) im Store. Abgelehnt, weil
ungültige Kombinationen möglich wären.

Quelle: https://refactoring.guru/design-patterns/state

### 3.4 Command Pattern (Behavioral): Bedienung

**Anwendung:** Alle Auslöser – Knöpfe der Transportleiste, Klicks auf Zeit- und Stationsleiste,
Tastenkürzel – erzeugen dieselben `PlaybackCommand`-Objekte
(`{ type: 'next' }`, `{ type: 'seek', step, station }`, …), die `controller.dispatch(command)`
ausführt. Die Tastaturbelegung ist eine Tabelle `KeyBinding → PlaybackCommand`.

**Begründung:** Eine Aktion, mehrere Auslöser; Tests rufen `dispatch` direkt auf, ohne UI.

Quelle: https://refactoring.guru/design-patterns/command

### 3.5 Observer (Behavioral) + Strategy für Zeit

**Anwendung:** Der Controller ist ein Observable (`subscribe(listener) → unsubscribe`); der
Zustand-Store spiegelt ihn für React. Zeit kommt über eine **Scheduler-Strategy**
(`schedule(ms, callback) → cancel`): `timeoutScheduler` (setTimeout) in der App, `ManualScheduler`
in Tests (`advance(ms)`). Die Verweildauer je Frame liefert `durations.ts`:
Basiswert je Stationsart bei 1× (tokenize 1500 ms, embed 1200, attention 2000, residual 700,
mlp 1200, logits 1500, sample 1800) geteilt durch das Tempo.

**Begründung:** Deterministische Tests ohne Fake-Timer-Magie; die App bleibt austauschbar
(später z. B. `requestAnimationFrame`).

Quellen: https://refactoring.guru/design-patterns/observer ·
https://refactoring.guru/design-patterns/strategy

**Scheduler-Vertrag** (gilt für jede Implementierung, CON-0005):
- `schedule(ms, cb)` ruft `cb` nie synchron innerhalb von `schedule` auf; `ms < 0` gilt als 0.
- `cancel()` ist idempotent; nach `cancel()` wird `cb` nie mehr aufgerufen.
- `ManualScheduler.advance(ms)` führt alle Einträge mit Fälligkeit ≤ jetzt + ms aus, geordnet
  nach Fälligkeit, bei Gleichstand nach Einplanungsreihenfolge; Einträge, die ein Callback während
  `advance` einplant und die noch im Fenster fällig werden, laufen im selben `advance`.
  `pending()` liefert die Zahl der ausstehenden Einträge, `now()` die virtuelle Zeit.

### 3.6 Aurora-Theme

Tokens und Regeln aus ADR-0001 als CSS Custom Properties in `src/app/theme/tokens.css`
(einzige Stelle mit Farbwerten), dazu `src/app/theme/tokens.ts` mit denselben Werten für Tests
(Kontrastprüfung) und Datenskala. Schriften über `@fontsource` (Space Grotesk, Inter, JetBrains
Mono) gebündelt. Views nutzen nur `var(--tt-…)`. `prefers-reduced-motion: reduce` schaltet
Übergänge und Glow-Animationen ab.

### 3.7 Komposition und schmale View-Schnittstellen

Die App (`src/app/player/`) erzeugt den Controller mit `timeoutScheduler` genau einmal und
übergibt ihn an `createPlaybackStore(controller)`; der Store instanziiert nichts selbst
(Dependency Inversion). Jede View bekommt nur, was sie braucht:

| View | Props |
|---|---|
| `TransportBar` | `playing`, `speed`, `canBack`, `canForward`, `canStepBack`, `canStepForward`, `onCommand(command)`, `labels` |
| `StepTimeline` | `steps: { index, label }[]`, `current`, `onSeek(step)`, `labels` |
| `StationStrip` | `stations: { short, name }[]`, `current`, `onSeek(station)`, `labels` |
| `TokenStream` | `tokens: { text, isNew }[]`, `showNext`, `labels` |
| `StationView` | `frame: { step, station, count }`, `station: Station`, `renderers`, `labels` |

### 3.8 Registry für Stationsansichten (Open/Closed)

`StationView` wählt den Inhalt über eine Registry `StationRenderers = Partial<Record<StationKind,
StationRenderer>>`; ohne Eintrag gilt der generische Renderer (Erklärtext + Tensorformen,
bei logits/sample die Top-3-Kandidaten). SPEC-0004/0007 ergänzen Renderer durch Registrierung,
ohne `StationView` zu ändern.

Quelle: https://refactoring.guru/design-patterns/strategy

### 3.9 Warum Theme und Playback in einer Spec

Das Theme ist ausdrücklich Teil dieser Spec (Wunsch: der Player soll gleich im Aurora-Look
entstehen). Es hat aber einen eigenen Contract (Theme) und eigene Tests und lässt sich damit
unabhängig versionieren und ändern; Playback-Contracts referenzieren keine Farbwerte.

### 3.10 Seitenaufbau

Von oben nach unten: Kopf (Titel, Untertitel) → Inspector-Steuerung (Prompt, Max. Tokens,
Erzeugen, Export, Import aus SPEC-0001) → Fehlermeldung → **Tokenstrom** → **Stationsansicht** →
**Transportleiste** (Zeitleiste der Schritte, Stationsleiste des aktuellen Schritts, Knöpfe, Tempo,
Kürzel-Hinweis) → **Details**: die Schrittliste aus SPEC-0001 unverändert (CON-0003 gilt weiter).
Die Transportleiste ist erst sichtbar, wenn ein Trace mit mindestens einem Schritt geladen ist.

### 3.12 Festlegungen aus den test-first geschriebenen Tests

- **Module:** `@/playback/types` exportiert `PlaybackCommand`, `PlaybackState`, `Speed`, `SPEEDS`, `Frame`; `@/playback/controller` zusätzlich den Typ `PlaybackController`. `state.trace` ist referenzgleich mit dem geladenen Trace; No-ops lassen `getState()` referenzgleich.
- **ESLint für `src/playback/**`:** `setTimeout`/`setInterval`/`requestAnimationFrame`/`performance.now`/`Date.now`/`new Date()` verboten (`no-restricted-syntax` bzw. `no-restricted-globals`); Override für `src/playback/scheduler.ts`.
- **Theme:** `src/app/theme/tokens.css` (Werte, Font-Variablen, `color-scheme`), weitere Theme-CSS-Dateien unter `src/app/theme/`; `:root` außerhalb von `@media`; T-05-Selektor exakt `*, *::before, *::after`, T-07 als eigene Regel `:focus-visible`. `tokens.ts` ist ohne Vite-Alias ladbar (Playwright importiert es relativ) und typisiert `COLORS['blue-deep']`.
- **DOM:** Regionen „Wiedergabe“, „Tokenstrom“, „Station“ existieren ohne Trace nicht; Gruppen „Tempo“, „Zeitleiste“, „Stationen“ liegen in „Wiedergabe“. In der DOM- und Tab-Reihenfolge stehen die Transportknöpfe **vor** Zeit- und Stationsleiste (Tab erreicht „Station vor“ in ≤ 20 Schritten ab „Erzeugen“). Stationsknöpfe in Trace-Reihenfolge; genau eine `h2` in „Station“; genau eine `list` im Tokenstrom; genau ein `role=status` auf der Seite. Alle Knöpfe in „Wiedergabe“ ≥ 44 × 44 px (auch Stations-, Zeitleisten- und Tempoknöpfe).
- **Schriften:** erste berechnete Familie von `body` `Inter Variable`, von `h1` `Space Grotesk`.

## 4. Funktionale Anforderungen

- **FR-01:** `src/playback/frames.ts` flacht einen Trace zu Frames ab und liefert die abgeleiteten Werte aus 3.2 (aktueller Schritt/Station, Position im Schritt, Fortschritt 0–1, sichtbare Tokens mit Markierung des neuen Tokens).
- **FR-02:** `src/playback/controller.ts` implementiert `createPlaybackController({ scheduler, durations? })` mit `load(trace | null)`, `dispatch(command)`, `getState()` und `subscribe(listener)` nach dem Zustandsmodell aus 3.3. Kommandos: `play`, `pause`, `toggle`, `next`, `prev`, `nextStep`, `prevStep`, `first`, `last`, `seek(step, station)`, `setSpeed(speed)`.
- **FR-03:** Während `playing` rückt der Cursor nach der Verweildauer des aktuellen Frames (3.5) automatisch vor; beim Erreichen des letzten Frames endet die Wiedergabe (`mode: 'paused'`, Cursor bleibt). `play` am letzten Frame startet am ersten Frame neu.
- **FR-04:** Manuelle Navigation (`next`, `prev`, `nextStep`, `prevStep`, `first`, `last`, `seek`) pausiert eine laufende Wiedergabe. Navigation über die Ränder hinaus bleibt am Rand stehen (kein Umlauf). `nextStep`/`prevStep` springen auf die erste Station des nächsten/vorigen Schritts; `prevStep` innerhalb eines Schritts (Station > 0) springt zuerst auf dessen erste Station.
- **FR-05:** `setSpeed` ändert das Tempo; während `playing` gilt das neue Tempo ab sofort für die verbleibende Zeit des aktuellen Frames anteilig. Erlaubt sind 0.25, 0.5, 1 und 2; Default 1.
- **FR-06:** `load` setzt den Cursor auf den ersten Frame (bzw. `null`), stoppt die Wiedergabe und behält das Tempo. `seek` auf nicht existierende Schritte/Stationen wird ignoriert.
- **FR-07:** `src/playback/scheduler.ts` liefert `timeoutScheduler` und `ManualScheduler` (`advance(ms)`, `pending()`, `now()`) nach dem Scheduler-Vertrag aus 3.5; der Controller nutzt ausschließlich die injizierte Strategy (keine Timer-APIs direkt; ESLint-Regel wie CON-0004 R-04 für `src/playback/**` außer `scheduler.ts`).
- **FR-08:** `src/playback/store.ts` stellt einen übergebenen Controller über einen Zustand-Store für React bereit (`createPlaybackStore(controller)` → Hook `usePlayback(selector)`), ohne eigene Logik und ohne selbst Controller oder Scheduler zu erzeugen (3.7).
- **FR-09:** Die **Transportleiste** (`src/views/transport/`) zeigt Knöpfe „Zum Anfang“, „Schritt zurück“, „Station zurück“, „Abspielen“/„Pause“, „Station vor“, „Schritt vor“, „Zum Ende“ (Icon-Knöpfe mit `aria-label`), eine Tempo-Gruppe (0.25× bis 2×, `aria-pressed`), eine **Zeitleiste** (je Schritt ein Knopf „Schritt n“, aktueller mit `aria-current="step"`) und eine **Stationsleiste** des aktuellen Schritts (je Station ein Knopf mit Kurzlabel und vollem Namen als `aria-label`, aktueller mit `aria-current="step"`). Klicks lösen `seek` aus. Knöpfe an Rändern sind deaktiviert.
- **FR-10:** Der **Tokenstrom** (`src/views/token-stream/`) zeigt die sichtbaren Tokens des aktuellen Frames; das neu gewählte Token (ab `sample`) ist hervorgehoben, danach folgt ein Platzhalter „?“ für das nächste Token, solange der Lauf nicht zu Ende ist.
- **FR-11:** Die **Stationsansicht** (`src/views/station/`, Registry aus 3.8) zeigt „Schritt n · Station i / k“, den Stationstitel (`kind`, bei Layer-Stationen „· Layer l“, bei residual zusätzlich „nach Attention“/„nach MLP“), einen kurzen Erklärtext je Stationsart und die Tensorformen; bei `logits`/`sample` die drei wahrscheinlichsten Kandidaten mit Wahrscheinlichkeit als Text.
- **FR-12:** Tastaturkürzel (auf `document`, CON-0006): Leertaste = Abspielen/Pause, ←/→ = Station zurück/vor, Shift+←/→ = Schritt zurück/vor, Pos1/Ende = Anfang/Ende. Kürzel greifen nicht, wenn der Fokus in einem Textfeld, Zahlenfeld, Schieberegler oder Auswahlfeld liegt; die Leertaste greift zusätzlich nicht auf fokussierten Knöpfen (native Aktivierung).
- **FR-13:** Eine `aria-live="polite"`-Region meldet bei jedem Cursorwechsel „Schritt n · Station i von k · Titel“ (während `playing` höchstens bei Schrittwechsel, um Screenreader nicht zu fluten).
- **FR-14:** Das **Aurora-Theme** nach ADR-0001 gilt für die ganze App: Tokens in `src/app/theme/tokens.css` + `tokens.ts`, gebündelte Schriften, Verläufe, Glow nur am aktiven Element, `prefers-reduced-motion` respektiert. Farbwerte (Hex/RGB/HSL) stehen ausschließlich in `src/app/theme/`.
- **FR-15:** Alle neuen Texte stehen in `src/app/texts.ts`; die Views bekommen sie als Props (Views importieren nicht aus `src/app`). Jede View hat die schmale Props-Schnittstelle aus 3.7.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                              | um ...                                                  |
|-------|----------------|-------------------------------------------------------------|---------------------------------------------------------|
| US-01 | Vortragende/r  | per Leertaste und Pfeiltasten Station für Station weiterschalten | frei zu erzählen und das Tempo selbst zu bestimmen  |
| US-02 | Lernende/r     | den Lauf automatisch langsam abspielen und jederzeit zurückspulen | den Ablauf in Ruhe nachzuvollziehen                |
| US-03 | Lernende/r     | sehen, wo im Durchlauf ich gerade bin (Schritt, Station, Token) | die Orientierung nicht zu verlieren                  |
| US-04 | Vortragende/r  | eine gut lesbare, auffällige Oberfläche am Beamer            | dass auch die letzte Reihe folgen kann                 |

## 6. Nicht-funktionale Anforderungen

| Kategorie       | Anforderung |
|-----------------|-------------|
| Performance     | Cursorwechsel rendert in < 16 ms bei Traces bis 32 Schritte × 12 Stationen (kein Neuaufbau der Detailliste pro Frame) |
| Accessibility   | WCAG 2.1 AA: Kontrast ≥ 4.5:1 (Text), sichtbarer Fokusring, alle Funktionen per Tastatur, Bedienelemente ≥ 44 px |
| Determinismus   | Controller ohne direkte Zeit-APIs; Tests ohne echte Wartezeiten |
| Datenschutz     | Keine Anfragen an fremde Origins (Schriften gebündelt) |
| Wartbarkeit     | Farbwerte nur in `src/app/theme/`; Views ohne Kenntnis des Controllers |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: Abspielen eines Traces

  Scenario: Station für Station
    Given ein Mock-Trace "die katze sitzt" mit 2 Schritten ist geladen
    When ich zweimal "Station vor" auslöse
    Then zeigt die Stationsansicht "Schritt 0 · Station 3 / 12" und "attention · Layer 0"

  Scenario: Automatisches Abspielen bis zum Ende
    Given ein geladener Trace mit 2 Schritten und Tempo 2×
    When ich "Abspielen" auslöse und die Summe aller Verweildauern vergeht
    Then steht der Cursor auf dem letzten Frame und die Wiedergabe ist pausiert

  Scenario: Tastatur
    Given ein geladener Trace und der Fokus liegt nicht in einem Eingabefeld
    When ich Shift+→ drücke
    Then steht der Cursor auf der ersten Station von Schritt 1

  Scenario: Lesbarkeit
    Then erreicht jedes Text-/Grund-Paar des Themes mindestens 4.5:1
```

Die vollständigen, verbindlichen Szenarien stehen in den Contracts (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Trace mit 0 Schritten (z. B. sofortiger Abbruch): Transportleiste ausgeblendet, Controller `idle`, Kommandos wirkungslos.
- Trace mit 1 Schritt: Zeitleiste mit einem Eintrag; Schritt vor/zurück deaktiviert.
- Remote-artiger Trace (nur tokenize/logits/sample): Stationsleiste zeigt 3 bzw. 2 Stationen; Stationsansicht zeigt keine Tensorformen.
- Neuer Trace während `playing` (Erzeugen oder Import): Wiedergabe stoppt, Cursor auf Anfang.
- Fehlgeschlagener Import: Cursor und Wiedergabe bleiben unverändert (CON-0003 UI-02).
- Tempowechsel kurz vor Frame-Ende: kein doppelter Vorschub, kein negativer Rest.
- `seek` auf den aktuellen Frame: keine Änderung, kein Listener-Aufruf.
- Mehrfaches `play`: kein zweiter Timer (genau ein ausstehender Scheduler-Eintrag).

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0005 | behavior (gherkin) | Playback-Controller, Frames, Verweildauern, Scheduler-Vertrag |
| CON-0006 | behavior (gherkin) | Player-UI: Transportleiste, Tempo, Zeit-/Stationsleiste, Tokenstrom, Stationsansicht, Status, Tastatur, Theme im Browser |
| CON-0007 | behavior (markdown) | Aurora-Theme-Regeln T-01–T-07 (Tokens, Kontrast, Farbwerte nur im Theme, Schriften, Bewegung, Dark Mode, Fokus) |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0005 | unit       | Alle Szenarien aus CON-0005 mit ManualScheduler; INV-08 per Lint-Fixture |
| TST-0006 | acceptance | Playwright: alle Szenarien aus CON-0006 (mit page.clock) |
| TST-0007 | unit       | Theme-Regeln T-01–T-08 aus CON-0007 |

## 11. Implementierungsreihenfolge

1. Theme: Tokens (CSS + TS), Schriften, globale Styles, Restyling des Inspectors (FR-14)
2. Playback-Kern: frames, scheduler, durations, controller, ESLint-Regel für playback (FR-01–FR-07)
3. Store und Tastatur-Hook (FR-08, FR-12)
4. Views: Transportleiste, Zeit-/Stationsleiste, Tokenstrom, Stationsansicht, Live-Region (FR-09–FR-11, FR-13, FR-15)
5. Playwright-Akzeptanztests

## 12. Offene Fragen

- [x] Verweildauern: Sind die Basiswerte aus 3.5 (z. B. attention 2 s, residual 0,7 s bei 1×) ein guter Start, oder soll jede Station gleich lang stehen?
  **Antwort (2026-10-21, Boris):** Je Stationsart wie in 3.5. Ein Schritt mit 2 Layern dauert bei 1× etwa 14 s.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-21 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-21 | 0.2.0   | Boris  | Review: Scheduler-Vertrag, Komposition/DI, schmale View-Props, Renderer-Registry, Begründung Theme+Playback |
