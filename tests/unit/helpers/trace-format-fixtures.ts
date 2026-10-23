import { expect } from 'vitest';

import { generate } from '@/engine/generate';
import { MockEngine } from '@/engine/mock/mock-engine';
import { createRng } from '@/engine/rng';
import { GreedySampler } from '@/engine/samplers/greedy';
import { checkInvariants } from '@/trace/invariants';
import { TraceRecorder } from '@/trace/recorder';
import { validateTrace } from '@/trace/schema';
import { deserializeTrace, serializeTrace, TraceImportError } from '@/trace/serialize';
import type { StationKind, Trace } from '@/trace/types';

// --- Serialisierte Form (CON-0001), so wie JSON.parse(serializeTrace(t)) sie liefert ---

export interface SToken {
  id: number;
  text: string;
}

export interface SCandidate {
  token: SToken;
  logit: number | null;
  prob: number;
}

export interface STensor {
  shape: number[];
  dtype: string;
  data: string;
}

export interface SStation {
  kind: string;
  layer?: number;
  after?: string;
  tokens?: SToken[];
  vocabSize?: number | null;
  coverage?: number | null;
  distribution?: SCandidate[];
  random?: number | null;
  chosen?: SToken;
  [field: string]: unknown;
}

export interface SStep {
  index: number;
  contextTokens: SToken[];
  newPositions: number[];
  stations: SStation[];
  chosen: SToken;
  text: string;
  [field: string]: unknown;
}

export interface SArchitecture {
  nLayers: number;
  nHeads: number;
  dModel: number;
  dMlp: number;
  vocabSize: number;
  contextLength: number;
}

export interface SEngine {
  kind: string;
  model: string;
  capabilities: string[];
  architecture: SArchitecture | null;
  eosTokenId: number | null;
  [field: string]: unknown;
}

export interface STrace {
  schemaVersion: unknown;
  id: string;
  createdAt: string;
  engine: SEngine;
  prompt: string;
  maxTokens: number;
  sampling: { strategy: string; seed: number; params: Record<string, unknown> };
  steps: SStep[];
  finishReason: string;
  error?: { message: string };
  [field: string]: unknown;
}

// --- Trace-Erzeugung über die echte Pipeline ---

export interface MakeTraceOptions {
  prompt?: string;
  maxTokens?: number;
  capabilities?: StationKind[];
  eosAt?: number;
}

export const FIXED_ID = 'trace-test';
export const FIXED_TIME = '2026-10-21T12:00:00Z';

export async function makeTrace(options: MakeTraceOptions = {}): Promise<Trace> {
  const engine = new MockEngine({
    weightSeed: 1234,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
    ...(options.eosAt !== undefined ? { eosAt: options.eosAt } : {}),
  });
  await engine.load();
  const recorder = new TraceRecorder({ idProvider: () => FIXED_ID, clock: () => FIXED_TIME });
  const events = generate(
    engine,
    new GreedySampler(),
    { prompt: options.prompt ?? 'die katze sitzt', maxTokens: options.maxTokens ?? 4, seed: 42 },
    { createRng },
  );
  const iterator = recorder.record(events)[Symbol.asyncIterator]();
  let result = await iterator.next();
  while (result.done !== true) {
    result = await iterator.next();
  }
  return recorder.build();
}

export function toSerialized(trace: Trace): STrace {
  return JSON.parse(serializeTrace(trace)) as STrace;
}

export function parseSerialized(json: string): STrace {
  return JSON.parse(json) as STrace;
}

// --- Zugriffshelfer ---

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Index ${index} außerhalb von [0, ${items.length})`);
  }
  return item;
}

export interface FoundStation {
  station: SStation;
  index: number;
}

export function findStation(
  step: SStep,
  kind: string,
  layer?: number,
  after?: string,
): FoundStation {
  const index = step.stations.findIndex(
    (s) =>
      s.kind === kind &&
      (layer === undefined || s.layer === layer) &&
      (after === undefined || s.after === after),
  );
  if (index < 0) {
    throw new Error(`Station ${kind}/${String(layer)}/${String(after)} nicht gefunden`);
  }
  return { station: at(step.stations, index), index };
}

function isTensor(value: unknown): value is STensor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'shape' in value &&
    'dtype' in value &&
    'data' in value
  );
}

export function tensorOf(station: SStation, field: string): STensor {
  const value = station[field];
  if (!isTensor(value)) {
    throw new Error(`Feld ${field} der Station ${station.kind} ist kein Tensor`);
  }
  return value;
}

export function distributionOf(station: SStation): SCandidate[] {
  if (station.distribution === undefined) {
    throw new Error(`Station ${station.kind} hat keine distribution`);
  }
  return station.distribution;
}

/** Alle Tensoren eines serialisierten Traces (Station + Feldname). */
export function allTensors(trace: STrace): STensor[] {
  const tensors: STensor[] = [];
  for (const step of trace.steps) {
    for (const station of step.stations) {
      for (const value of Object.values(station)) {
        if (isTensor(value)) {
          tensors.push(value);
        }
      }
    }
  }
  return tensors;
}

// --- Base64 little-endian float32 ---

export function decodeF32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const values = new Float32Array(Math.floor(bytes.byteLength / 4));
  for (let i = 0; i < values.length; i += 1) {
    values[i] = view.getFloat32(i * 4, true);
  }
  return values;
}

export function encodeF32(values: Float32Array): string {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return encodeBytes(new Uint8Array(view.buffer));
}

export function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Erwartungen ---

export function importJson(json: string): () => Trace {
  return () => deserializeTrace(json);
}

export function catchImportError(run: () => unknown): TraceImportError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TraceImportError);
    if (error instanceof TraceImportError) {
      return error;
    }
  }
  throw new Error('deserializeTrace hat keinen TraceImportError geworfen');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function pathStartingWith(prefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(prefix)}`);
}

/** Das Objekt bleibt schema-gültig (die Mutation trifft nur die Semantik). */
export function expectSchemaValid(trace: STrace): void {
  const result = validateTrace(trace);
  expect(result.ok ? [] : result.errors).toEqual([]);
}

/** Vollständig gültig: Schema, Invarianten und Import. */
export function expectValid(trace: STrace): void {
  expectSchemaValid(trace);
  expect(checkInvariants(trace)).toEqual([]);
  expect(() => deserializeTrace(JSON.stringify(trace))).not.toThrow();
}

/**
 * Die Mutation verletzt genau die Semantik: Schema gültig, `checkInvariants` meldet die
 * Invariante mit passendem Pfad, und der Import wirft `kind: 'semantic'`.
 */
export function expectViolation(trace: STrace, invariant: string, pathPrefix: string): void {
  expectSchemaValid(trace);
  const expected = expect.objectContaining({
    invariant,
    path: expect.stringMatching(pathStartingWith(pathPrefix)) as unknown,
  }) as unknown;
  expect(checkInvariants(trace)).toContainEqual(expected);
  const error = catchImportError(importJson(JSON.stringify(trace)));
  expect(error.kind).toBe('semantic');
  expect(error.errors).toContainEqual(expected);
}

export function removeField(target: object, field: string): void {
  Reflect.deleteProperty(target, field);
}
