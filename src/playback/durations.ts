import type { Station, StationKind } from '../trace/types';
import type { Speed } from './types';

/** Verweildauer je Stationsart bei Tempo 1× in ms (SPEC-0002 §3.5). */
export const BASE_DURATIONS: Readonly<Record<StationKind, number>> = {
  tokenize: 1500,
  embed: 1200,
  attention: 2000,
  residual: 700,
  mlp: 1200,
  logits: 1500,
  sample: 1800,
};

/** Verweildauer in ganzen ms beim Tempo `speed`. */
export function durationFor(station: Station, speed: Speed): number {
  return Math.round(BASE_DURATIONS[station.kind] / speed);
}
