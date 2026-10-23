---
id: CON-0005
project: ""                # PRJ-XXXX
title: "Playback controller behavior"
type: behavior
format: gherkin
spec: SPEC-0002
version: 0.1.0
status: approved
artifact: ".sdd/contracts/behavior/playback-controller-behavior.feature"
tests: ["TST-0005"]
---

# Contract: Playback controller behavior

> **Spec:** SPEC-0002 · **Typ:** Verhalten (Gherkin) · **Status:** approved

## Zweck

Legt das Verhalten des UI-unabhängigen Abspielers fest: Frames aus einem Trace, Cursor,
Zustandsmodell `idle`/`paused`/`playing`, Navigation, automatisches Vorrücken über einen
injizierten Scheduler, Tempo, Listener und den Scheduler-Vertrag selbst.

## Garantien

Die Szenarien im Artifact (`.sdd/contracts/behavior/playback-controller-behavior.feature`) sind
ausführbare Spezifikation. Jedes Szenario ist ein Vitest-Test, Testname = Szenariotitel wörtlich;
beim Szenariogrundriss `"<Titel> (tempo=<tempo>)"` bzw. `"<Titel> (step=<step>, station=<station>)"`. Ein Abgleichtest prüft Titel und Beispiele
gegen die Feature-Datei.

## API

```ts
// src/playback/types.ts
export const SPEEDS = [0.25, 0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];
export type PlaybackMode = 'idle' | 'paused' | 'playing';
export interface Frame { step: number; station: number }
export type PlaybackCommand =
  | { type: 'play' } | { type: 'pause' } | { type: 'toggle' }
  | { type: 'next' } | { type: 'prev' } | { type: 'nextStep' } | { type: 'prevStep' }
  | { type: 'first' } | { type: 'last' }
  | { type: 'seek'; step: number; station: number }
  | { type: 'setSpeed'; speed: number };
export interface PlaybackState {
  trace: Trace | null;
  frames: readonly Frame[];
  cursor: number | null;       // null ⇔ frames.length === 0
  mode: PlaybackMode;          // 'idle' ⇔ frames.length === 0
  speed: Speed;
}

// src/playback/scheduler.ts
export type Cancel = () => void;
export interface Scheduler { schedule(ms: number, callback: () => void): Cancel; now(): number }
export const timeoutScheduler: Scheduler;
export class ManualScheduler implements Scheduler { advance(ms: number): void; pending(): number }

// src/playback/durations.ts
export const BASE_DURATIONS: Readonly<Record<StationKind, number>>;
export function durationFor(station: Station, speed: Speed): number; // BASE / speed

// src/playback/frames.ts
export function buildFrames(trace: Trace | null): Frame[];
export interface FrameInfo { step: number; station: number; stationCount: number; stepCount: number; progress: number }
export function frameInfo(state: PlaybackState): FrameInfo | null;
export interface VisibleToken { text: string; isNew: boolean }
export function visibleTokens(state: PlaybackState): { tokens: VisibleToken[]; showNext: boolean };

// src/playback/controller.ts
export interface PlaybackController {
  load(trace: Trace | null): void;
  dispatch(command: PlaybackCommand): void;
  getState(): PlaybackState;
  subscribe(listener: (state: PlaybackState) => void): () => void;
  dispose(): void;
}
export function createPlaybackController(options: {
  scheduler: Scheduler;
  durations?: (station: Station, speed: Speed) => number; // Default durationFor
}): PlaybackController;
```

## Invarianten

- **INV-01 Zustand:** `cursor === null ⇔ frames.length === 0 ⇔ mode === 'idle'`. Sonst gilt
  `0 ≤ cursor < frames.length`.
- **INV-02 Ein Timer:** Im Modus `playing` gibt es genau einen ausstehenden Scheduler-Eintrag des
  Controllers, sonst keinen.
- **INV-03 Vorrücken:** Ein Frame bleibt `durations(station, speed)` ms stehen. Erreicht der
  Cursor den letzten Frame, endet die Wiedergabe sofort (`paused`, kein Eintrag).
- **INV-04 Manuelle Navigation pausiert** (`next`, `prev`, `nextStep`, `prevStep`, `first`,
  `last` und gültiges `seek`), auch wenn sich der Cursor dadurch nicht ändert. Ein `seek` ist
  gültig, wenn `step` und `station` ganze Zahlen ≥ 0 sind und der Frame existiert; ein ungültiges
  `seek` wird vollständig ignoriert (kein Pausieren, kein Listener-Aufruf).
- **INV-05 Tempo:** Nur Werte aus `SPEEDS`; andere und das bereits gesetzte Tempo werden
  ignoriert (No-op). Während `playing` wird die Restzeit des aktuellen Frames zu
  `max(0, round(rest · alt / neu))` ms (ganze ms) neu eingeplant; der alte Eintrag wird
  abgebrochen. Verweildauern sind ganze ms (`round(BASE / speed)`).
- **INV-06 Listener:** Genau ein Aufruf je tatsächlicher Zustandsänderung, synchron nach der
  Änderung; kein Aufruf bei No-ops (`pause` in `paused`, gleiches Tempo, `seek` auf den aktuellen
  Frame im Modus `paused`, Navigation am Rand im Modus `paused`). `load` zählt immer als Änderung
  (INV-07). Abmelden ist idempotent. `getState()` liefert ein eingefrorenes Objekt, das bei jeder
  Änderung neu ist (Referenzvergleich für React/Zustand).
- **INV-07 load:** Cursor auf 0 (bzw. `null`), Modus `paused` (bzw. `idle`), Tempo bleibt, Timer
  abgebrochen. `load` erzeugt immer einen neuen Snapshot und löst genau einen Listener-Aufruf aus,
  auch bei `load(null)` auf einem frischen Controller.
- **INV-07a dispose:** bricht den Timer ab; danach sind `dispatch` und `load` wirkungslos und
  rufen keine Listener, `subscribe` liefert eine wirkungslose Abmeldefunktion, `getState()` den
  letzten Zustand.
- **INV-07b play:** in `idle` wirkungslos; am letzten Frame Neustart bei Frame 0 (INV-03 greift
  erst nach dessen Verweildauer).
- **INV-08 Keine Zeit-APIs:** `src/playback/**` außer `scheduler.ts` nutzt weder `setTimeout`,
  `setInterval`, `requestAnimationFrame`, `Date.now`, `performance.now` noch `new Date()`
  (ESLint, CON-0004 R-04 erweitert).
- **INV-09 Scheduler-Vertrag:** Callback nie synchron in `schedule`; `ms < 0` gilt als 0;
  `cancel` idempotent und endgültig; `advance` in Fälligkeits-, bei Gleichstand
  Einplanungsreihenfolge, inklusive währenddessen eingeplanter, im Fenster fälliger Einträge.
- **INV-10 Sichtbare Tokens** (Felder aus CON-0001: `contextTokens`, `chosen`, `finishReason`):
  Vor der `sample`-Station eines Schritts: `contextTokens`. Ab
  `sample` zusätzlich `chosen` mit `isNew: true` (ein `<eos>` wird nicht angezeigt).
  `showNext` ist falsch genau am letzten Frame des Traces, wenn der Lauf mit `max-tokens` oder
  `eos` endete, sonst wahr.
- **INV-11 Fortschritt:** `progress = cursor / (frames.length − 1)`; bei genau einem Frame 1
  (mit gültigen Traces nicht erreichbar, da jeder Schritt mindestens logits und sample hat).

## Begriffe

| Begriff | Definition |
|---|---|
| Frame | Eine Station eines Schritts; die kleinste Abspieleinheit |
| Cursor | Index des angezeigten Frames |
| Basis-Trace B | Siehe Kopfkommentar des Features |
