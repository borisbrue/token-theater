import { generate } from '@/engine/generate';
import { MockEngine } from '@/engine/mock/mock-engine';
import { createRng } from '@/engine/rng';
import { GreedySampler } from '@/engine/samplers/greedy';
import { createPlaybackController, type PlaybackController } from '@/playback/controller';
import { durationFor } from '@/playback/durations';
import { ManualScheduler } from '@/playback/scheduler';
import type { PlaybackState, Speed } from '@/playback/types';
import { TraceRecorder } from '@/trace/recorder';
import type { Station, StationKind, Trace } from '@/trace/types';

export interface TraceOptions {
  prompt?: string;
  maxTokens?: number;
  capabilities?: StationKind[];
}

/** Trace über die echte Kette aus SPEC-0001 (MockEngine weightSeed 1234, Greedy, Seed 42). */
export async function makeTrace(options: TraceOptions = {}): Promise<Trace> {
  const engine = new MockEngine({
    weightSeed: 1234,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });
  await engine.load();
  const recorder = new TraceRecorder({
    idProvider: () => 'trace-playback',
    clock: () => '2026-10-21T12:00:00Z',
  });
  const events = generate(
    engine,
    new GreedySampler(),
    { prompt: options.prompt ?? 'die katze sitzt', maxTokens: options.maxTokens ?? 2, seed: 42 },
    { createRng },
  );
  for await (const event of recorder.record(events)) {
    void event;
  }
  return recorder.build();
}

/** Basis-Trace B aus CON-0005: "die katze sitzt", maxTokens 2 → 12 + 11 Stationen. */
export function makeBaseTrace(): Promise<Trace> {
  return makeTrace();
}

/** Trace mit 0 Schritten (wie nach sofortigem Abbruch). */
export function emptyTraceFrom(trace: Trace): Trace {
  return { ...trace, steps: [], finishReason: 'aborted' };
}

export interface Setup {
  scheduler: ManualScheduler;
  controller: PlaybackController;
  /** Alle Zustände, mit denen der Listener aufgerufen wurde. */
  calls: PlaybackState[];
  unsubscribe: () => void;
}

/** Frischer ManualScheduler + Controller, Listener angemeldet; optional Trace geladen. */
export function setup(trace?: Trace | null): Setup {
  const scheduler = new ManualScheduler();
  const controller = createPlaybackController({ scheduler });
  const calls: PlaybackState[] = [];
  const unsubscribe = controller.subscribe((state) => calls.push(state));
  if (trace !== undefined) {
    controller.load(trace);
  }
  return { scheduler, controller, calls, unsubscribe };
}

export function stationAt(state: PlaybackState, index: number): Station {
  const frame = state.frames[index];
  if (frame === undefined) throw new Error(`Frame ${index} fehlt`);
  const station = state.trace?.steps[frame.step]?.stations[frame.station];
  if (station === undefined) throw new Error(`Station für Frame ${index} fehlt`);
  return station;
}

/** Summe der Verweildauern der Frames from..to (inklusive) beim Tempo `speed`. */
export function sumDurations(state: PlaybackState, from: number, to: number, speed: Speed): number {
  let total = 0;
  for (let i = from; i <= to; i += 1) total += durationFor(stationAt(state, i), speed);
  return total;
}

export function findStation(trace: Trace, kind: StationKind): Station {
  for (const step of trace.steps) {
    const station = step.stations.find((s) => s.kind === kind);
    if (station !== undefined) return station;
  }
  throw new Error(`Keine Station ${kind} im Trace`);
}
