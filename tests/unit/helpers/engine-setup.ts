import type { GenerateDeps, InferenceEngine, Sampler } from '@/engine/types';
import type {
  GenerationStep,
  Station,
  StationKind,
  Tensor,
  Trace,
  TraceEvent,
} from '@/trace/types';
import { createRng } from '@/engine/rng';
import { generate } from '@/engine/generate';
import { GreedySampler } from '@/engine/samplers/greedy';
import { MockEngine } from '@/engine/mock/mock-engine';
import { TraceRecorder } from '@/trace/recorder';

export const FIXED_ID = 'trace-test';
export const FIXED_CLOCK = '2026-10-21T12:00:00Z';
export const SAMPLING_SEED = 42;
export const DEFAULT_WEIGHT_SEED = 1234;

export interface MockOptions {
  weightSeed?: number;
  capabilities?: StationKind[];
  eosAt?: number;
}

export interface Setup {
  engine: InferenceEngine;
  sampler: Sampler;
  recorder: TraceRecorder;
  deps: GenerateDeps;
}

/** Frischer Aufbau je Szenario: keine geteilten Zustände zwischen Tests. */
export async function freshSetup(
  options: MockOptions = {},
  engine?: InferenceEngine,
  sampler?: Sampler,
): Promise<Setup> {
  const e = engine ?? new MockEngine({ weightSeed: DEFAULT_WEIGHT_SEED, ...options });
  await e.load();
  return {
    engine: e,
    sampler: sampler ?? new GreedySampler(),
    recorder: new TraceRecorder({ idProvider: () => FIXED_ID, clock: () => FIXED_CLOCK }),
    deps: { createRng },
  };
}

export interface RunResult {
  events: TraceEvent[];
  trace: Trace;
}

export interface RunOptions {
  seed?: number;
  signal?: AbortSignal;
  /** Wird nach jedem Event aufgerufen, das der nachgelagerte Konsument erhält. */
  onEvent?: (event: TraceEvent) => void;
}

/** Erzeugt und zeichnet auf; liefert die durch den Recorder gereichten Events und den Trace. */
export async function run(
  setup: Setup,
  prompt: string,
  maxTokens: number,
  options: RunOptions = {},
): Promise<RunResult> {
  const source = generate(
    setup.engine,
    setup.sampler,
    { prompt, maxTokens, seed: options.seed ?? SAMPLING_SEED },
    setup.deps,
    options.signal,
  );
  const events: TraceEvent[] = [];
  for await (const event of setup.recorder.record(source)) {
    events.push(event);
    options.onEvent?.(event);
  }
  return { events, trace: setup.recorder.build() };
}

export async function collect(source: AsyncIterable<TraceEvent>): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

/** Typfolge der Events als String, z. B. "run-start step-start station step-end done". */
export function eventPattern(events: readonly TraceEvent[]): string {
  return events.map((e) => e.type).join(' ');
}

export function kinds(step: GenerationStep): string {
  return step.stations.map((s) => s.kind).join(', ');
}

export function stationsOf<K extends StationKind>(
  step: GenerationStep,
  kind: K,
): Extract<Station, { kind: K }>[] {
  return step.stations.filter((s): s is Extract<Station, { kind: K }> => s.kind === kind);
}

export function stepAt(trace: Trace, index: number): GenerationStep {
  const step = trace.steps[index];
  if (!step) throw new Error(`Schritt ${index} fehlt (Trace hat ${trace.steps.length} Schritte)`);
  return step;
}

export function lastEvent(events: readonly TraceEvent[]): TraceEvent {
  const event = events[events.length - 1];
  if (!event) throw new Error('keine Events');
  return event;
}

/** Element eines Tensors über einen mehrdimensionalen Index (row-major). */
export function at(tensor: Tensor, index: readonly number[]): number {
  let offset = 0;
  for (let d = 0; d < tensor.shape.length; d++) {
    const size = tensor.shape[d] ?? 1;
    offset = offset * size + (index[d] ?? 0);
  }
  const value = tensor.data[offset];
  if (value === undefined)
    throw new Error(`Index ${index.join(',')} außerhalb von ${tensor.shape}`);
  return value;
}

export function expectClose(actual: Float32Array, expected: Float32Array, tolerance: number): void {
  if (actual.length !== expected.length) {
    throw new Error(`Länge ${actual.length} ≠ ${expected.length}`);
  }
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i] ?? Number.NaN;
    const b = expected[i] ?? Number.NaN;
    if (!(Math.abs(a - b) <= tolerance)) {
      throw new Error(`Element ${i}: ${a} ≠ ${b} (Toleranz ${tolerance})`);
    }
  }
}

export function add(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** Wartet, bis ausstehende Microtasks/Timer abgearbeitet sind. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
