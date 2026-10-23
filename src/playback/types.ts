import type { Trace } from '../trace/types';

/** Erlaubte Abspieltempi (SPEC-0002 FR-05). */
export const SPEEDS = [0.25, 0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export type PlaybackMode = 'idle' | 'paused' | 'playing';

/** Eine Station eines Schritts – die kleinste Abspieleinheit. */
export interface Frame {
  step: number;
  station: number;
}

/** Bedienbefehle (Command Pattern, SPEC-0002 §3.4). */
export type PlaybackCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'nextStep' }
  | { type: 'prevStep' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'seek'; step: number; station: number }
  | { type: 'setSpeed'; speed: number };

export interface PlaybackState {
  trace: Trace | null;
  frames: readonly Frame[];
  /** null ⇔ frames leer */
  cursor: number | null;
  /** 'idle' ⇔ frames leer */
  mode: PlaybackMode;
  speed: Speed;
}

export function isSpeed(value: number): value is Speed {
  return (SPEEDS as readonly number[]).includes(value);
}
