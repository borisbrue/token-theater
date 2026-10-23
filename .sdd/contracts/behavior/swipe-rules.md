# Wisch-Regeln (CON-0028)

Prüfung: TST-0031 (`tests/unit/swipe.test.ts`, Vitest, Node). Koordinaten in CSS-Pixeln, Zeit in
Millisekunden.

```ts
// @/app/player/swipe
export interface SwipePoint { x: number; y: number; t: number }
export const SWIPE: { readonly minDistance: 60; readonly maxDuration: 800; readonly ratio: 2 };
export function swipeCommand(start: SwipePoint, end: SwipePoint): PlaybackCommand | null;
export function swipeIgnored(target: EventTarget | null): boolean;
```

## SW-01 Richtung
`dx = end.x − start.x`, `dy = end.y − start.y`. `dx ≤ −60` → `{ type: 'next' }`, `dx ≥ 60` →
`{ type: 'prev' }` (Inhalt folgt dem Finger: nach links wischen holt die nächste Station).

## SW-02 Mindestweg
`|dx| < 60` → `null` (59 nicht, 60 schon).

## SW-03 Waagerecht
`|dx| < 2 · |dy|` → `null` (senkrechtes Scrollen). Genau `|dx| = 2 · |dy|` zählt als Wisch.

## SW-04 Dauer
`end.t − start.t > 800` → `null`; genau 800 zählt; negative Dauer → `null`.

## SW-05 Ausgenommene Ziele
`swipeIgnored` ist `true` für `input`, `textarea`, `select`, Elemente mit `isContentEditable` und
alles innerhalb eines Elements mit `data-swipe="ignore"` (`closest('[data-swipe="ignore"]')`);
sonst `false`, auch für `null` und Objekte ohne `closest`. Die Funktion prüft über `tagName`,
`isContentEditable` und `closest` statt `instanceof Element`, damit sie ohne DOM testbar ist.
Elemente mit eigener Geste (Canvas von Heatmap und Vektorstreifen, `.moe-scroll`, `.compare-scroll`)
tragen `data-swipe="ignore"` selbst (SPEC-0013 §3.3).

## SW-06 Kommandos
Die Rückgabe ist ein Playback-Kommando aus `@/playback/types` (Command, SPEC-0002); es gibt keine
weiteren Arten.
