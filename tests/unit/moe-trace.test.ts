// TST-0024 · CON-0001 v0.5.0 (Station moe, INV-05/06/08 erweitert, INV-18) und CON-0023 MS-01..MS-09.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { MoeStation, ResidualStation, Station, Trace } from '@/trace/types';
import { MOCK_MOE, MockEngine } from '@/engine/mock/mock-engine';
import { createRng } from '@/engine/rng';
import { createEngine } from '@/app/engine-factory';
import { deserializeTrace, serializeTrace } from '@/trace/serialize';
import { TraceImportError } from '@/trace/import-chain';
import { checkInvariants } from '@/trace/invariants';

import {
  buildMoeTrace,
  decodeTensor,
  encodeTensor,
  moeIndex,
  type Json,
} from '../e2e/moe-trace-helpers';
import {
  add,
  expectClose,
  FIXED_CLOCK,
  FIXED_ID,
  freshSetup,
  run,
  stepAt,
} from './helpers/engine-setup';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const BEFORE = JSON.parse(
  readFileSync(join(repoRoot, 'tests/fixtures/moe/mock-dense-before-spec-0011.json'), 'utf8'),
) as { full: { sha256: string }; withoutInternals: { sha256: string } };

const PROMPT = 'die katze sitzt';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Serialisierter synthetischer Trace mit 2 Layern, 4 Experten, Top-2. */
const synthetic = (options: { dense?: number[] } = {}): Json =>
  buildMoeTrace({ layers: 2, experts: 4, topK: 2, ...options });

function stationAt(trace: Json, index: number): Json {
  const steps = trace['steps'] as Json[];
  const stations = steps[0]?.['stations'] as Json[];
  const station = stations[index];
  if (station === undefined) throw new Error(`Station ${index} fehlt`);
  return station;
}

function importError(trace: Json): TraceImportError {
  try {
    deserializeTrace(JSON.stringify(trace));
  } catch (error) {
    if (error instanceof TraceImportError) return error;
    throw error;
  }
  throw new Error('Import hätte scheitern müssen');
}

/** Erwartet einen semantischen Befund `invariant`, dessen Pfad mit `path` beginnt. */
function expectSemantic(trace: Json, invariant: string, path: string): void {
  const error = importError(trace);
  expect(error.kind).toBe('semantic');
  const match = error.errors.find((e) => e.invariant === invariant && e.path.startsWith(path));
  expect(match, JSON.stringify(error.errors)).toBeDefined();
}

async function mockMoeTrace(weightSeed = 1234): Promise<Trace> {
  const setup = await freshSetup({}, new MockEngine({ weightSeed, moe: MOCK_MOE }));
  return (await run(setup, PROMPT, 3)).trace;
}

const moeStations = (stations: readonly Station[]): MoeStation[] =>
  stations.filter((s): s is MoeStation => s.kind === 'moe');

const residualAfter = (
  stations: readonly Station[],
  layer: number,
  after: ResidualStation['after'],
): ResidualStation => {
  const found = stations.find(
    (s): s is ResidualStation => s.kind === 'residual' && s.layer === layer && s.after === after,
  );
  if (found === undefined) throw new Error(`residual ${layer} nach ${after} fehlt`);
  return found;
};

function softmax(values: readonly number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / total);
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('CON-0001 v0.5.0: Schema der Station moe', () => {
  it('ein synthetischer MoE-Trace ist gültig', () => {
    const trace = deserializeTrace(JSON.stringify(synthetic()));
    expect(trace.engine.architecture).toMatchObject({ nExperts: 4, topK: 2 });
    expect(moeStations(stepAt(trace, 0).stations)).toHaveLength(2);
  });

  it('ein gemischter Trace aus dichtem Layer 0 und MoE-Layer 1 ist gültig (INV-05)', () => {
    const trace = deserializeTrace(JSON.stringify(synthetic({ dense: [0] })));
    const kinds = stepAt(trace, 0).stations.map((s) => s.kind);
    expect(kinds).toEqual([
      'tokenize',
      'attention',
      'residual',
      'mlp',
      'residual',
      'attention',
      'residual',
      'moe',
      'residual',
      'logits',
      'sample',
    ]);
  });

  it('Re-Export ist JSON-tief gleich', () => {
    const original = synthetic();
    const again = JSON.parse(serializeTrace(deserializeTrace(JSON.stringify(original)))) as Json;
    expect(again).toEqual(original);
  });

  it('fehlt routerLogits, ist das ein Schemafehler', () => {
    const trace = synthetic();
    delete stationAt(trace, moeIndex(0))['routerLogits'];
    expect(importError(trace).kind).toBe('schema');
  });

  it('ein Gate 0 ist ein Schemafehler', () => {
    const trace = synthetic();
    (stationAt(trace, moeIndex(0))['gates'] as number[][])[0] = [1, 0];
    expect(importError(trace).kind).toBe('schema');
  });

  it('nExperts 1 ist ein Schemafehler', () => {
    const trace = synthetic();
    const engine = trace['engine'] as Json;
    (engine['architecture'] as Json)['nExperts'] = 1;
    expect(importError(trace).kind).toBe('schema');
  });
});

describe('CON-0001 v0.5.0: INV-05, INV-06, INV-08', () => {
  it('INV-05: residual nach moe mit after "mlp"', () => {
    const trace = synthetic();
    stationAt(trace, moeIndex(0) + 1)['after'] = 'mlp';
    expectSemantic(trace, 'INV-05', '/steps/0');
  });

  it('INV-05: residual nach mlp mit after "moe"', () => {
    const trace = synthetic({ dense: [0] });
    stationAt(trace, 4)['after'] = 'moe';
    expectSemantic(trace, 'INV-05', '/steps/0');
  });

  it('INV-06: moe in capabilities, aber architecture ohne nExperts', () => {
    const trace = synthetic();
    const architecture = (trace['engine'] as Json)['architecture'] as Json;
    delete architecture['nExperts'];
    expectSemantic(trace, 'INV-06', '/engine');
  });

  it('INV-06: topK größer als nExperts', () => {
    const trace = synthetic();
    const architecture = (trace['engine'] as Json)['architecture'] as Json;
    architecture['topK'] = 5;
    expectSemantic(trace, 'INV-06', '/engine');
  });

  it('INV-08: routerLogits mit falscher Breite', () => {
    const trace = synthetic();
    stationAt(trace, moeIndex(0))['routerLogits'] = encodeTensor([2, 3], [0, 0, 0, 0, 0, 0]);
    expectSemantic(trace, 'INV-08', `/steps/0/stations/${moeIndex(0)}/routerLogits`);
  });

  it('INV-08: moe.out mit falscher Form', () => {
    const trace = synthetic();
    stationAt(trace, moeIndex(1))['out'] = encodeTensor([2, 3], [0, 0, 0, 0, 0, 0]);
    expectSemantic(trace, 'INV-08', `/steps/0/stations/${moeIndex(1)}/out`);
  });
});

describe('CON-0001 v0.5.0: INV-18 Routing', () => {
  const at = `/steps/0/stations/${moeIndex(0)}/`;

  it('INV-18: zu viele Experten in einer Zeile', () => {
    const trace = synthetic();
    const station = stationAt(trace, moeIndex(0));
    const experts = station['experts'] as number[][];
    const gates = station['gates'] as number[][];
    experts[0] = [...(experts[0] ?? []), 99];
    gates[0] = [0.5, 0.3, 0.2];
    expectSemantic(trace, 'INV-18', `${at}experts/0`);
  });

  it('INV-18: experts hat nicht n Zeilen', () => {
    const trace = synthetic();
    const station = stationAt(trace, moeIndex(0));
    (station['experts'] as number[][]).pop();
    (station['gates'] as number[][]).pop();
    expectSemantic(trace, 'INV-18', at);
  });

  it('INV-18: doppelte Experten-ID', () => {
    const trace = synthetic();
    const experts = stationAt(trace, moeIndex(0))['experts'] as number[][];
    const first = experts[0]?.[0] ?? 0;
    experts[0] = [first, first];
    expectSemantic(trace, 'INV-18', `${at}experts/0`);
  });

  it('INV-18: Experten-ID außerhalb von 0 … nExperts − 1', () => {
    const trace = synthetic();
    const experts = stationAt(trace, moeIndex(0))['experts'] as number[][];
    experts[1] = [experts[1]?.[0] ?? 0, 4];
    expectSemantic(trace, 'INV-18', `${at}experts/1`);
  });

  it('INV-18: Gates nicht absteigend', () => {
    const trace = synthetic();
    const gates = stationAt(trace, moeIndex(0))['gates'] as number[][];
    gates[0] = [...(gates[0] ?? [])].reverse();
    expectSemantic(trace, 'INV-18', `${at}gates/0`);
  });

  it('INV-18: Summe der Gates über 1', () => {
    const trace = synthetic();
    (stationAt(trace, moeIndex(0))['gates'] as number[][])[0] = [0.7, 0.6];
    expectSemantic(trace, 'INV-18', `${at}gates/0`);
  });

  it('INV-18: gates und experts verschieden lang', () => {
    const trace = synthetic();
    (stationAt(trace, moeIndex(0))['gates'] as number[][])[1] = [1];
    expectSemantic(trace, 'INV-18', `${at}gates/1`);
  });

  it('INV-18: gewählter Experte schwächer als ein nicht gewählter', () => {
    const trace = synthetic();
    const station = stationAt(trace, moeIndex(0));
    const logits = decodeTensor(station['routerLogits']).slice(0, 4);
    const experts = station['experts'] as number[][];
    const chosen = new Set(experts[0]);
    const weakest = logits
      .map((value, e) => ({ value, e }))
      .filter((entry) => !chosen.has(entry.e))
      .sort((a, b) => a.value - b.value)[0];
    experts[0] = [weakest?.e ?? 0, experts[0]?.[1] ?? 0];
    expectSemantic(trace, 'INV-18', `${at}experts/0`);
  });

  it('INV-18: eine Summe unter 1 ist erlaubt (ohne Renormierung)', () => {
    const trace = synthetic();
    (stationAt(trace, moeIndex(0))['gates'] as number[][])[0] = [0.5, 0.3];
    expect(checkInvariants(trace)).toEqual([]);
  });

  it('INV-18: Gleichstand an der Grenze erlaubt beide Wahlen', () => {
    const trace = synthetic();
    const station = stationAt(trace, moeIndex(0));
    station['routerLogits'] = encodeTensor([2, 4], [1, 0.5, 0.5, 0, 1, 0.5, 0.5, 0]);
    station['experts'] = [
      [0, 2],
      [0, 1],
    ];
    const gate = softmax([1, 0.5]);
    station['gates'] = [gate, gate];
    expect(checkInvariants(trace)).toEqual([]);
  });
});

describe('MS-01 Info der Mock-MoE-Engine', () => {
  it('MS-01: Modell, Fähigkeiten und Architektur', () => {
    expect(MOCK_MOE).toEqual({ nExperts: 4, topK: 2 });
    const info = new MockEngine({ moe: MOCK_MOE }).info;
    expect(info.kind).toBe('mock');
    expect(info.model).toBe('mock-de-52-moe');
    expect(info.capabilities).toEqual([
      'tokenize',
      'embed',
      'attention',
      'moe',
      'residual',
      'logits',
      'sample',
    ]);
    expect(info.architecture).toEqual({
      nLayers: 2,
      nHeads: 2,
      dModel: 8,
      dMlp: 16,
      vocabSize: 52,
      contextLength: 64,
      nExperts: 4,
      topK: 2,
    });
  });
});

describe('MS-02 Stationen', () => {
  it('MS-02: Folge mit moe statt mlp, residual nach moe', async () => {
    const trace = await mockMoeTrace();
    trace.steps.forEach((step, s) => {
      const names = step.stations.map((st) =>
        st.kind === 'residual' ? `residual-${st.after}` : st.kind,
      );
      const layer = ['attention', 'residual-attention', 'moe', 'residual-moe'];
      expect(names).toEqual([
        ...(s === 0 ? ['tokenize'] : []),
        'embed',
        ...layer,
        ...layer,
        'logits',
        'sample',
      ]);
    });
  });

  it('MS-02: Export und Import ohne Befund, Formen nach CON-0001', async () => {
    const trace = await mockMoeTrace();
    const json = serializeTrace(trace);
    expect(() => deserializeTrace(json)).not.toThrow();
    expect(checkInvariants(JSON.parse(json))).toEqual([]);
    for (const step of trace.steps) {
      const n = step.newPositions[1] - step.newPositions[0];
      for (const station of moeStations(step.stations)) {
        expect(station.lnIn.shape).toEqual([n, 8]);
        expect(station.out.shape).toEqual([n, 8]);
        expect(station.routerLogits.shape).toEqual([n, 4]);
        expect(station.experts).toHaveLength(n);
        expect(station.gates).toHaveLength(n);
        station.experts.forEach((row) => expect(row).toHaveLength(2));
      }
    }
  });
});

describe('MS-03 Routing', () => {
  it('MS-03: Top-2 der Router-Logits, Gates = Softmax der gewählten, absteigend', async () => {
    const trace = await mockMoeTrace();
    for (const step of trace.steps) {
      for (const station of moeStations(step.stations)) {
        station.experts.forEach((chosen, i) => {
          const logits = Array.from(station.routerLogits.data.subarray(i * 4, (i + 1) * 4));
          const expected = logits
            .map((value, e) => ({ value, e }))
            .sort((a, b) => b.value - a.value || a.e - b.e)
            .slice(0, 2)
            .map((entry) => entry.e);
          expect(chosen).toEqual(expected);
          const gates = station.gates[i] ?? [];
          const reference = softmax(chosen.map((e) => logits[e] ?? 0));
          gates.forEach((g, j) => expect(g).toBeCloseTo(reference[j] ?? 0, 6));
          expect(gates[0] ?? 0).toBeGreaterThanOrEqual(gates[1] ?? 0);
          expect(Math.abs(gates.reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(1e-6);
        });
      }
    }
  });
});

describe('MS-04 Beitrag zum Residual Stream', () => {
  it('MS-04: residual nach moe = residual nach attention + moe.out', async () => {
    const trace = await mockMoeTrace();
    for (const step of trace.steps) {
      for (const station of moeStations(step.stations)) {
        const before = residualAfter(step.stations, station.layer, 'attention');
        const after = residualAfter(step.stations, station.layer, 'moe');
        expectClose(after.stream.data, add(before.stream.data, station.out.data), 1e-5);
      }
    }
  });
});

describe('MS-05 Bestand bleibt bytegleich', () => {
  it('MS-05: Mock ohne moe hat denselben SHA-256 wie vor SPEC-0011', async () => {
    const full = (await run(await freshSetup(), PROMPT, 3)).trace;
    expect(full.id).toBe(FIXED_ID);
    expect(full.createdAt).toBe(FIXED_CLOCK);
    expect(sha256(serializeTrace(full))).toBe(BEFORE.full.sha256);
    const plain = (
      await run(await freshSetup({ capabilities: ['tokenize', 'logits', 'sample'] }), PROMPT, 3)
    ).trace;
    expect(sha256(serializeTrace(plain))).toBe(BEFORE.withoutInternals.sha256);
  });

  it('MS-05: Mock und Mock-MoE teilen embed und die Attention von Layer 0', async () => {
    const dense = stepAt((await run(await freshSetup(), PROMPT, 1)).trace, 0);
    const moe = stepAt(
      (
        await run(
          await freshSetup({}, new MockEngine({ weightSeed: 1234, moe: MOCK_MOE })),
          PROMPT,
          1,
        )
      ).trace,
      0,
    );
    const pick = (stations: readonly Station[], kind: string): string =>
      serializeTrace({ steps: [stations.find((s) => s.kind === kind)] } as unknown as Trace);
    expect(pick(moe.stations, 'embed')).toBe(pick(dense.stations, 'embed'));
    expect(pick(moe.stations, 'attention')).toBe(pick(dense.stations, 'attention'));
  });
});

describe('MS-06 Determinismus', () => {
  it('MS-06: gleicher Seed bytegleich, anderer Seed andere Router-Logits', async () => {
    const a = serializeTrace(await mockMoeTrace());
    const b = serializeTrace(await mockMoeTrace());
    expect(a).toBe(b);
    const other = await mockMoeTrace(99);
    const first = (trace: Trace): number[] =>
      Array.from(moeStations(stepAt(trace, 0).stations)[0]?.routerLogits.data ?? []);
    expect(first(other)).not.toEqual(first(await mockMoeTrace()));
  });
});

describe('MS-07 Fehler', () => {
  it.each([
    ['moe mit mlp in capabilities', { moe: MOCK_MOE, capabilities: ['mlp', 'logits', 'sample'] }],
    ['moe in capabilities ohne Option', { capabilities: ['moe', 'logits', 'sample'] }],
    ['nExperts < 2', { moe: { nExperts: 1, topK: 1 } }],
    ['topK < 1', { moe: { nExperts: 4, topK: 0 } }],
    ['topK > nExperts', { moe: { nExperts: 4, topK: 5 } }],
    ['nicht ganzzahlig', { moe: { nExperts: 4.5, topK: 2 } }],
  ] as const)('MS-07: RangeError bei %s', (_name, options) => {
    expect(
      () => new MockEngine(clone(options) as ConstructorParameters<typeof MockEngine>[0]),
    ).toThrow(RangeError);
  });
});

describe('MS-08 Logit-Lens nach MoE', () => {
  it('MS-08: 5 Einträge nach moe, keine nach der Attention, letzte Lens = logits', async () => {
    const trace = await mockMoeTrace();
    for (const step of trace.steps) {
      const residuals = step.stations.filter((s): s is ResidualStation => s.kind === 'residual');
      for (const station of residuals) {
        if (station.after === 'moe') expect(station.lens).toHaveLength(5);
        else expect('lens' in station).toBe(false);
      }
      const last = residuals.at(-1);
      const logits = step.stations.find((s) => s.kind === 'logits');
      if (logits?.kind !== 'logits') throw new Error('logits fehlt');
      expect(last?.lens?.map((c) => c.token.id)).toEqual(
        logits.distribution.slice(0, 5).map((c) => c.token.id),
      );
    }
  });
});

describe('MS-09 Engine-Art mock-moe', () => {
  const deps = { createRng, idProvider: () => FIXED_ID, clock: () => FIXED_CLOCK };

  it('MS-09: createEngine("mock-moe") ist die Mock-MoE-Engine', () => {
    const engine = createEngine('mock-moe', deps);
    expect(engine.info.model).toBe('mock-de-52-moe');
    expect(engine.info.architecture).toMatchObject({ nExperts: 4, topK: 2 });
  });

  it('MS-09: createEngine("mock") bleibt ohne moe', () => {
    const engine = createEngine('mock', deps);
    expect(engine.info.model).toBe('mock-de-52');
    expect(engine.info.capabilities).not.toContain('moe');
    expect(engine.info.architecture).not.toHaveProperty('nExperts');
  });
});
