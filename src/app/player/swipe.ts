import type { PlaybackCommand } from '../../playback/types';

/** Wisch-Regeln über der Station (SPEC-0013 §3.3, CON-0028). Rein, ohne DOM. */

export interface SwipePoint {
  x: number;
  y: number;
  /** Zeitpunkt in Millisekunden. */
  t: number;
}

export const SWIPE = { minDistance: 60, maxDuration: 800, ratio: 2 } as const;

/** Nach links wischen → nächste Station, nach rechts → vorige; sonst null (SW-01–SW-04). */
export function swipeCommand(start: SwipePoint, end: SwipePoint): PlaybackCommand | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const duration = end.t - start.t;
  if (duration < 0 || duration > SWIPE.maxDuration) return null;
  if (Math.abs(dx) < SWIPE.minDistance || Math.abs(dx) < SWIPE.ratio * Math.abs(dy)) return null;
  return dx < 0 ? { type: 'next' } : { type: 'prev' };
}

const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

interface ElementLike {
  tagName?: unknown;
  isContentEditable?: unknown;
  closest?: unknown;
}

/**
 * Behält das Startziel den Wisch selbst (SW-05)? Eingabefelder, bearbeitbare Elemente und alles
 * in einem Element mit `data-swipe="ignore"` (Chain of Responsibility: das Element entscheidet,
 * nicht eine Liste). Ohne DOM prüfbar: nur `tagName`, `isContentEditable` und `closest`.
 */
export function swipeIgnored(target: EventTarget | null): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const { tagName, isContentEditable, closest } = target as ElementLike;
  if (typeof tagName === 'string' && INPUT_TAGS.has(tagName.toUpperCase())) return true;
  if (isContentEditable === true) return true;
  if (typeof closest !== 'function') return false;
  const owner: unknown = closest.call(target, '[data-swipe="ignore"]');
  return owner !== null && owner !== undefined;
}
