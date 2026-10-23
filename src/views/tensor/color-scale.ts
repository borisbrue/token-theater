/**
 * Farbskalen als Daten (SPEC-0007 §3.4, CON-0017 V-03/V-04): Die Stopps kommen vom Theme über
 * den Player herein; hier stehen keine Farbwerte.
 */

export interface ScaleStop {
  at: number;
  /** '#rrggbb' */
  color: string;
}

/** Kanäle R, G, B einer Farbe '#rrggbb'. */
export function channels(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Farbe an Stelle `t` (auf [0, 1] begrenzt, NaN = 0), linear zwischen den Nachbarstopps. */
export function sampleScale(stops: readonly ScaleStop[], t: number): string {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) throw new RangeError('Skala ohne Stopps');
  const x = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  if (x <= first.at && x < (stops[1]?.at ?? Infinity)) return first.color.toLowerCase();
  if (x >= last.at) return last.color.toLowerCase();
  // Der letzte Stopp mit at ≤ x und sein Nachfolger; gleiche at ergeben eine harte Kante.
  let lower = 0;
  for (let i = 0; i < stops.length; i += 1) if ((stops[i]?.at ?? Infinity) <= x) lower = i;
  const from = stops[lower] ?? first;
  const to = stops[lower + 1] ?? last;
  const span = to.at - from.at;
  const f = span > 0 ? (x - from.at) / span : 0;
  const a = channels(from.color);
  const b = channels(to.color);
  return hex(a.map((c, i) => c + ((b[i] ?? c) - c) * f));
}

/** Stelle eines Werts auf einer um 0 symmetrischen Skala mit Grenze `limit`. */
export function divergingPosition(value: number, limit: number): number {
  if (!(limit > 0)) return 0.5;
  return Math.min(1, Math.max(0, 0.5 + value / (2 * limit)));
}
