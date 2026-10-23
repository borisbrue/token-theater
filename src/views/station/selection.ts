/**
 * Auswahl in den Stationsansichten (SPEC-0007 §3.8, Mediator): Der Player hält sie, diese Regeln
 * legen fest, was sie für eine Station bedeutet. Alle Ansichten nutzen nur diese Funktionen.
 */

export interface StationSelection {
  /** Absolute Position im Kontext; null = letzte Zeile. */
  position: number | null;
  head: number | 'mean';
  history: boolean;
}

export const DEFAULT_SELECTION: StationSelection = { position: null, head: 0, history: true };

/** Zeilenindex der Station für die gewählte Position; gibt es sie nicht, die letzte Zeile. */
export function selectedRow(selection: StationSelection, newPositions: [number, number]): number {
  const [a, b] = newPositions;
  const { position } = selection;
  return position !== null && position >= a && position < b ? position - a : b - a - 1;
}

/** Gewählter Kopf; außerhalb von 0 … heads − 1 gilt Kopf 0. */
export function selectedHead(selection: StationSelection, heads: number): number | 'mean' {
  const { head } = selection;
  if (head === 'mean') return head;
  return Number.isInteger(head) && head >= 0 && head < heads ? head : 0;
}
