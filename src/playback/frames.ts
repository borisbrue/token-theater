import type { Station, Trace } from '../trace/types';
import type { Frame, PlaybackState } from './types';

/** Flacht einen Trace zu Frames ab: eine Station je Frame, in Trace-Reihenfolge. */
export function buildFrames(trace: Trace | null): Frame[] {
  if (trace === null) return [];
  return trace.steps.flatMap((step, stepIndex) =>
    step.stations.map((_, station) => ({ step: stepIndex, station })),
  );
}

export interface FrameInfo {
  step: number;
  station: number;
  stationCount: number;
  stepCount: number;
  /** 0 bis 1 */
  progress: number;
}

function currentFrame(state: PlaybackState): Frame | null {
  if (state.cursor === null) return null;
  return state.frames[state.cursor] ?? null;
}

export function frameInfo(state: PlaybackState): FrameInfo | null {
  const frame = currentFrame(state);
  if (frame === null || state.trace === null || state.cursor === null) return null;
  const last = state.frames.length - 1;
  return {
    step: frame.step,
    station: frame.station,
    stationCount: state.trace.steps[frame.step]?.stations.length ?? 0,
    stepCount: state.trace.steps.length,
    progress: last <= 0 ? 1 : state.cursor / last,
  };
}

/** Die angezeigte Station des Cursors. */
export function currentStation(state: PlaybackState): Station | null {
  const frame = currentFrame(state);
  if (frame === null) return null;
  return state.trace?.steps[frame.step]?.stations[frame.station] ?? null;
}

export interface VisibleToken {
  text: string;
  isNew: boolean;
}

/**
 * Tokens des aktuellen Frames (CON-0005 INV-10): Kontext des Schritts, ab der sample-Station
 * zusätzlich das gewählte Token (ohne <eos>). showNext ist nur am letzten Frame eines
 * regulär beendeten Laufs falsch.
 */
export function visibleTokens(state: PlaybackState): { tokens: VisibleToken[]; showNext: boolean } {
  const frame = currentFrame(state);
  const trace = state.trace;
  if (frame === null || trace === null || state.cursor === null) {
    return { tokens: [], showNext: false };
  }
  const step = trace.steps[frame.step];
  if (step === undefined) return { tokens: [], showNext: false };
  const tokens: VisibleToken[] = step.contextTokens.map((t) => ({ text: t.text, isNew: false }));
  const sampleIndex = step.stations.findIndex((s) => s.kind === 'sample');
  if (
    sampleIndex >= 0 &&
    frame.station >= sampleIndex &&
    step.chosen.id !== trace.engine.eosTokenId
  ) {
    tokens.push({ text: step.chosen.text, isNew: true });
  }
  const atEnd = state.cursor === state.frames.length - 1;
  const finished = trace.finishReason === 'max-tokens' || trace.finishReason === 'eos';
  return { tokens, showNext: !(atEnd && finished) };
}
