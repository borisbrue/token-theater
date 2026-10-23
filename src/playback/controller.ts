import type { Station, Trace } from '../trace/types';
import { durationFor } from './durations';
import { buildFrames } from './frames';
import type { Cancel, Scheduler } from './scheduler';
import { isSpeed } from './types';
import type { Frame, PlaybackCommand, PlaybackState, Speed } from './types';

/**
 * Playback-Controller (SPEC-0002 §3.3–3.5, CON-0005): Zustandsmodell idle/paused/playing,
 * Kommandos über dispatch (Command), Zeit über einen injizierten Scheduler (Strategy),
 * Zustandsänderungen an Abonnenten (Observer). Ohne React.
 */

export interface PlaybackController {
  load(trace: Trace | null): void;
  dispatch(command: PlaybackCommand): void;
  getState(): PlaybackState;
  subscribe(listener: (state: PlaybackState) => void): () => void;
  dispose(): void;
}

export interface PlaybackControllerOptions {
  scheduler: Scheduler;
  durations?: (station: Station, speed: Speed) => number;
}

type Listener = (state: PlaybackState) => void;

function snapshot(state: PlaybackState): PlaybackState {
  return Object.freeze({ ...state });
}

function sameState(a: PlaybackState, b: PlaybackState): boolean {
  return (
    a.trace === b.trace &&
    a.frames === b.frames &&
    a.cursor === b.cursor &&
    a.mode === b.mode &&
    a.speed === b.speed
  );
}

export function createPlaybackController(options: PlaybackControllerOptions): PlaybackController {
  const { scheduler } = options;
  const durationOf = options.durations ?? durationFor;
  const listeners = new Set<Listener>();
  let state: PlaybackState = snapshot({
    trace: null,
    frames: Object.freeze([]),
    cursor: null,
    mode: 'idle',
    speed: 1,
  });
  let cancelTimer: Cancel | null = null;
  let dueAt = 0;
  let disposed = false;

  function notify(): void {
    for (const listener of [...listeners]) listener(state);
  }

  /** Übernimmt `next`, falls es sich vom aktuellen Zustand unterscheidet (INV-06). */
  function commit(next: PlaybackState, force = false): void {
    if (!force && sameState(state, next)) return;
    state = snapshot(next);
    notify();
  }

  function stopTimer(): void {
    cancelTimer?.();
    cancelTimer = null;
  }

  function stationAt(cursor: number): Station | undefined {
    const frame = state.frames[cursor];
    if (frame === undefined) return undefined;
    return state.trace?.steps[frame.step]?.stations[frame.station];
  }

  function startTimer(ms: number): void {
    stopTimer();
    dueAt = scheduler.now() + ms;
    cancelTimer = scheduler.schedule(ms, onTimer);
  }

  function scheduleCurrent(cursor: number, speed: Speed): void {
    const station = stationAt(cursor);
    if (station !== undefined) startTimer(durationOf(station, speed));
  }

  function onTimer(): void {
    cancelTimer = null;
    if (disposed || state.mode !== 'playing' || state.cursor === null) return;
    const last = state.frames.length - 1;
    const cursor = Math.min(state.cursor + 1, last);
    if (cursor >= last) {
      commit({ ...state, cursor, mode: 'paused' });
      return;
    }
    scheduleCurrent(cursor, state.speed);
    commit({ ...state, cursor });
  }

  function indexOf(frames: readonly Frame[], step: number, station: number): number {
    return frames.findIndex((f) => f.step === step && f.station === station);
  }

  /** Ziel der manuellen Navigation, oder null bei ungültigem seek (wird ignoriert). */
  function navigationTarget(command: PlaybackCommand, cursor: number): number | null {
    const { frames } = state;
    const last = frames.length - 1;
    const frame = frames[cursor];
    if (frame === undefined) return null;
    switch (command.type) {
      case 'next':
        return Math.min(cursor + 1, last);
      case 'prev':
        return Math.max(cursor - 1, 0);
      case 'first':
        return 0;
      case 'last':
        return last;
      case 'nextStep': {
        const target = indexOf(frames, frame.step + 1, 0);
        return target < 0 ? cursor : target;
      }
      case 'prevStep': {
        if (frame.station > 0) return indexOf(frames, frame.step, 0);
        const target = indexOf(frames, frame.step - 1, 0);
        return target < 0 ? cursor : target;
      }
      case 'seek': {
        const { step, station } = command;
        if (!Number.isInteger(step) || !Number.isInteger(station) || step < 0 || station < 0) {
          return null;
        }
        const target = indexOf(frames, step, station);
        return target < 0 ? null : target;
      }
      default:
        return null;
    }
  }

  function play(): void {
    if (state.mode !== 'paused' || state.cursor === null) return;
    const last = state.frames.length - 1;
    if (last <= 0) return;
    const cursor = state.cursor >= last ? 0 : state.cursor;
    scheduleCurrent(cursor, state.speed);
    commit({ ...state, cursor, mode: 'playing' });
  }

  function pause(): void {
    if (state.mode !== 'playing') return;
    stopTimer();
    commit({ ...state, mode: 'paused' });
  }

  function setSpeed(value: number): void {
    if (!isSpeed(value) || value === state.speed) return;
    if (state.mode === 'playing' && cancelTimer !== null) {
      const rest = Math.max(0, dueAt - scheduler.now());
      startTimer(Math.max(0, Math.round((rest * state.speed) / value)));
    }
    commit({ ...state, speed: value });
  }

  return {
    load(trace) {
      if (disposed) return;
      stopTimer();
      const frames = Object.freeze(buildFrames(trace));
      const empty = frames.length === 0;
      commit(
        {
          trace,
          frames,
          cursor: empty ? null : 0,
          mode: empty ? 'idle' : 'paused',
          speed: state.speed,
        },
        true,
      );
    },

    dispatch(command) {
      if (disposed || state.mode === 'idle' || state.cursor === null) return;
      switch (command.type) {
        case 'play':
          play();
          return;
        case 'pause':
          pause();
          return;
        case 'toggle':
          if (state.mode === 'playing') pause();
          else play();
          return;
        case 'setSpeed':
          setSpeed(command.speed);
          return;
        default: {
          const target = navigationTarget(command, state.cursor);
          if (target === null) return;
          stopTimer();
          commit({ ...state, cursor: target, mode: 'paused' });
        }
      }
    },

    getState: () => state,

    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      stopTimer();
      disposed = true;
      listeners.clear();
    },
  };
}
