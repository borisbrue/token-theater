// TST-0029 · CON-0026 CD-01..CD-07: Kennzahlen des Vergleichs (@/views/compare/diff), ohne Browser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { MOCK_MOE, MockEngine } from '@/engine/mock/mock-engine';
import { deserializeTrace, serializeTrace } from '@/trace/serialize';
import type {
  Candidate,
  GenerationStep,
  LogitsStation,
  MoeStation,
  ResidualStation,
  Station,
  Tensor,
  Trace,
} from '@/trace/types';
import {
  comparability,
  cosine,
  jsDivergence,
  largestDrop,
  layerDiff,
  OUTPUT_TOP_N,
  outputDiff,
  type LayerRow,
} from '@/views/compare/diff';

import { buildMoeTrace } from '../e2e/moe-trace-helpers';
import { DEFAULT_WEIGHT_SEED, freshSetup, run, stationsOf, stepAt } from './helpers/engine-setup';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const GRANITE = join(repoRoot, 'tests/fixtures/moe/tiny-granitemoe.trace.json');

async function mockTrace(prompt: string, options: Parameters<typeof freshSetup>[0] = {}) {
  return (await run(await freshSetup(options), prompt, 2)).trace;
}

async function moeTrace(prompt: string): Promise<Trace> {
  const engine = new MockEngine({ weightSeed: DEFAULT_WEIGHT_SEED, moe: MOCK_MOE });
  return (await run(await freshSetup({}, engine), prompt, 2)).trace;
}

const tokenOf = (id: number, text = `t${id}`) => ({ id, text });
const candidate = (id: number, prob: number): Candidate => ({
  token: tokenOf(id),
  logit: null,
  prob,
});

function logitsStep(distribution: Candidate[]): GenerationStep {
  const logits: LogitsStation = {
    kind: 'logits',
    vocabSize: 100,
    distribution,
    coverage: 1,
  };
  return {
    index: 0,
    contextTokens: [tokenOf(1)],
    newPositions: [0, 1],
    stations: [logits],
    chosen: tokenOf(distribution[0]?.token.id ?? 0),
    text: '',
  };
}

const rows = (values: readonly number[]): LayerRow[] =>
  values.map((value, layer) => ({
    layer,
    cosine: value,
    lensA: null,
    lensB: null,
    expertOverlap: null,
  }));

/** Letzte Zeile eines [n, d]-Tensors. */
function lastRow(tensor: Tensor): Float32Array {
  const [n = 0, d = 0] = tensor.shape;
  return tensor.data.slice((n - 1) * d, n * d);
}

function feedForwardResiduals(step: GenerationStep): ResidualStation[] {
  return stationsOf(step, 'residual').filter((s) => s.after !== 'attention');
}

function logitsOf(step: GenerationStep): LogitsStation {
  const [logits] = stationsOf(step, 'logits');
  if (logits === undefined) throw new Error('logits fehlt');
  return logits;
}

let katze: Trace;
let hund: Trace;

beforeAll(async () => {
  katze = await mockTrace('die katze sitzt');
  hund = await mockTrace('der hund sitzt');
});

describe('CD-01 Kosinus', () => {
  it('CD-01: feste Vektoren', () => {
    expect(cosine.name).toBe('cosine');
    expect(cosine.compute([1, 0], [0, 1])).toBeCloseTo(0, 12);
    expect(cosine.compute([1, 2], [2, 4])).toBeCloseTo(1, 12);
    expect(cosine.compute([1, 0], [-1, 0])).toBeCloseTo(-1, 12);
    expect(cosine.compute([0, 0], [0, 0])).toBe(1);
    expect(cosine.compute([0, 0], [1, 0])).toBe(0);
    expect(cosine.compute([1, 0], [0, 0])).toBe(0);
  });

  it('CD-01: nimmt Float32Array', () => {
    expect(cosine.compute(new Float32Array([3, 4]), new Float32Array([6, 8]))).toBeCloseTo(1, 6);
  });
});

describe('CD-02 JS-Divergenz', () => {
  it('CD-02: Grenzwerte und Referenzwert (Basis 2)', () => {
    expect(jsDivergence.name).toBe('js-divergence');
    expect(jsDivergence.compute([0.2, 0.8], [0.2, 0.8])).toBeCloseTo(0, 12);
    expect(jsDivergence.compute([1, 0], [0, 1])).toBeCloseTo(1, 12);
    expect(jsDivergence.compute([0.5, 0.5], [1, 0])).toBeCloseTo(0.311278124459133, 12);
  });

  it('CD-02: normiert die Eingaben und ist symmetrisch', () => {
    expect(jsDivergence.compute([2, 2], [1, 0])).toBeCloseTo(
      jsDivergence.compute([0.5, 0.5], [1, 0]),
      12,
    );
    expect(jsDivergence.compute([0.1, 0.6, 0.3], [0.5, 0.2, 0.3])).toBeCloseTo(
      jsDivergence.compute([0.5, 0.2, 0.3], [0.1, 0.6, 0.3]),
      12,
    );
  });

  it('CD-02: Ergebnis immer in [0, 1]', () => {
    const cases: [number[], number[]][] = [
      [
        [0.9, 0.1, 0],
        [0, 0.1, 0.9],
      ],
      [
        [1e-12, 1],
        [1, 1e-12],
      ],
      [
        [0.3, 0.3, 0.4],
        [0.3, 0.3, 0.4],
      ],
    ];
    for (const [p, q] of cases) {
      const value = jsDivergence.compute(p, q);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('CD-03 Vergleichbarkeit', () => {
  it('CD-03: Mock mit sich selbst und mit anderem Prompt → full', () => {
    expect(comparability(katze, katze)).toBe('full');
    expect(comparability(katze, hund)).toBe('full');
  });

  it('CD-03: Mock mit Mock-MoE → output', async () => {
    expect(comparability(katze, await moeTrace('die katze sitzt'))).toBe('output');
  });

  it('CD-03: Mock mit Mock ohne Interna → output', async () => {
    const plain = await mockTrace('die katze sitzt', {
      capabilities: ['tokenize', 'logits', 'sample'],
    });
    expect(comparability(katze, plain)).toBe('output');
    expect(comparability(plain, katze)).toBe('output');
  });

  it('CD-03: Mock mit Granite-Fixture → none', () => {
    const granite = deserializeTrace(readFileSync(GRANITE, 'utf8'));
    expect(comparability(katze, granite)).toBe('none');
    expect(comparability(granite, katze)).toBe('none');
  });

  it('CD-03: ohne architecture zählt vocabSize der logits-Station, ohne beide das Modell', () => {
    const noArch = (trace: Trace, model: string, vocab: number | null): Trace => ({
      ...trace,
      engine: { ...trace.engine, model, architecture: null },
      steps: trace.steps.map((step) => ({
        ...step,
        stations: step.stations.map((s) => (s.kind === 'logits' ? { ...s, vocabSize: vocab } : s)),
      })),
    });
    expect(comparability(katze, noArch(katze, 'server', 52))).toBe('output');
    expect(comparability(katze, noArch(katze, 'server', 99))).toBe('none');
    expect(comparability(noArch(katze, 'a', null), noArch(katze, 'b', null))).toBe('none');
    expect(comparability(noArch(katze, 'a', null), noArch(katze, 'a', null))).toBe('full');
    const plain = (trace: Trace): Trace => ({
      ...trace,
      engine: { ...trace.engine, capabilities: ['tokenize', 'logits', 'sample'] },
    });
    expect(comparability(noArch(katze, 'a', null), plain(noArch(katze, 'a', null)))).toBe('output');
  });
});

describe('CD-04 Ausgabe', () => {
  it('CD-04: Vereinigung der Top-10, pA/pB aus der ganzen Verteilung, delta = pB − pA', () => {
    expect(OUTPUT_TOP_N).toBe(10);
    for (const index of [0, 1]) {
      const a = stepAt(katze, index);
      const b = stepAt(hund, index);
      const diff = outputDiff(a, b);
      expect(diff).not.toBeNull();
      const distA = logitsOf(a).distribution;
      const distB = logitsOf(b).distribution;
      const top = (dist: readonly Candidate[]) =>
        [...dist].sort((x, y) => y.prob - x.prob).slice(0, 10);
      const union = new Set([...top(distA), ...top(distB)].map((c) => c.token.id));
      const ids = diff?.rows.map((r) => r.token.id) ?? [];
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort((x, y) => x - y)).toEqual([...union].sort((x, y) => x - y));
      const prob = (dist: readonly Candidate[], id: number) =>
        dist.find((c) => c.token.id === id)?.prob ?? 0;
      for (const row of diff?.rows ?? []) {
        expect(row.pA).toBe(prob(distA, row.token.id));
        expect(row.pB).toBe(prob(distB, row.token.id));
        expect(row.delta).toBeCloseTo(row.pB - row.pA, 12);
      }
    }
  });

  it('CD-04: sortiert nach |delta| absteigend, bei Gleichstand nach ID', () => {
    const a = logitsStep([candidate(5, 0.5), candidate(3, 0.3), candidate(9, 0.2)]);
    const b = logitsStep([candidate(3, 0.5), candidate(5, 0.3), candidate(7, 0.2)]);
    const diff = outputDiff(a, b);
    expect(diff?.rows.map((r) => r.token.id)).toEqual([3, 5, 7, 9]);
    expect(diff?.rows.map((r) => r.delta.toFixed(2))).toEqual(['0.20', '-0.20', '0.20', '-0.20']);
  });

  it('CD-04: Token nur in einem Lauf zählt dort 0; js über die Spalten', () => {
    const a = logitsStep([candidate(1, 0.7), candidate(2, 0.3)]);
    const b = logitsStep([candidate(3, 1)]);
    const diff = outputDiff(a, b);
    const byId = new Map(diff?.rows.map((r) => [r.token.id, r]));
    expect(byId.get(3)?.pA).toBe(0);
    expect(byId.get(1)?.pB).toBe(0);
    expect(diff?.js).toBeCloseTo(1, 12);
    expect(diff?.js).toBeCloseTo(
      jsDivergence.compute(diff?.rows.map((r) => r.pA) ?? [], diff?.rows.map((r) => r.pB) ?? []),
      12,
    );
  });

  it('CD-04: nur die ersten 10 je Lauf, auch bei langer Verteilung', () => {
    const dist = Array.from({ length: 30 }, (_, i) => candidate(i, (30 - i) / 465));
    const diff = outputDiff(logitsStep(dist), logitsStep(dist));
    expect(diff?.rows).toHaveLength(10);
  });

  it('CD-04: Schritt mit sich selbst → alle delta 0, js 0', () => {
    const diff = outputDiff(stepAt(katze, 0), stepAt(katze, 0));
    for (const row of diff?.rows ?? []) expect(row.delta).toBe(0);
    expect(diff?.js).toBeCloseTo(0, 12);
  });

  it('CD-04: ohne logits-Station → null', () => {
    const step = stepAt(katze, 0);
    const without: GenerationStep = {
      ...step,
      stations: step.stations.filter((s) => s.kind !== 'logits'),
    };
    expect(outputDiff(without, step)).toBeNull();
    expect(outputDiff(step, without)).toBeNull();
  });
});

describe('CD-05 Layer', () => {
  it('CD-05: eine Zeile je Layer mit residual nach dem Feed-Forward-Teil, aufsteigend', () => {
    const result = layerDiff(stepAt(katze, 0), stepAt(hund, 0));
    expect(result.map((r) => r.layer)).toEqual([0, 1]);
  });

  it('CD-05: Kosinus der letzten Zeile und Lens-Top-1', () => {
    for (const index of [0, 1]) {
      const a = stepAt(katze, index);
      const b = stepAt(hund, index);
      const result = layerDiff(a, b);
      const [resA, resB] = [feedForwardResiduals(a), feedForwardResiduals(b)];
      result.forEach((row, i) => {
        const sa = resA[i];
        const sb = resB[i];
        if (sa === undefined || sb === undefined) throw new Error('residual fehlt');
        expect(row.cosine).toBeCloseTo(cosine.compute(lastRow(sa.stream), lastRow(sb.stream)), 9);
        expect(row.lensA).toEqual(sa.lens?.[0]?.token ?? null);
        expect(row.lensB).toEqual(sb.lens?.[0]?.token ?? null);
        expect(row.expertOverlap).toBeNull();
      });
    }
  });

  it('CD-05: ohne lens → null', () => {
    const strip = (step: GenerationStep): GenerationStep => ({
      ...step,
      stations: step.stations.map((s): Station => {
        if (s.kind !== 'residual') return s;
        return { kind: 'residual', layer: s.layer, after: s.after, stream: s.stream };
      }),
    });
    const result = layerDiff(strip(stepAt(katze, 0)), stepAt(hund, 0));
    for (const row of result) expect(row.lensA).toBeNull();
  });

  it('CD-05: Mock-MoE mit sich selbst → expertOverlap 1, Kosinus 1', async () => {
    const moe = await moeTrace('die katze sitzt');
    const result = layerDiff(stepAt(moe, 0), stepAt(moe, 0));
    expect(result).toHaveLength(2);
    for (const row of result) {
      expect(row.expertOverlap).toBe(1);
      expect(row.cosine).toBeCloseTo(1, 6);
    }
  });

  it('CD-05: Anteil gemeinsamer Experten der letzten Zeile ([1, 3] und [3, 0] → 0,5)', () => {
    const trace = deserializeTrace(
      JSON.stringify(buildMoeTrace({ layers: 2, experts: 4, topK: 2 })),
    );
    const step = stepAt(trace, 0);
    const withExperts = (experts: number[]): GenerationStep => ({
      ...step,
      stations: step.stations.map((s): Station => {
        if (s.kind !== 'moe' || s.layer !== 1) return s;
        const moe: MoeStation = { ...s, experts: [s.experts[0] ?? [], experts] };
        return moe;
      }),
    });
    const result = layerDiff(withExperts([1, 3]), withExperts([3, 0]));
    expect(result.find((r) => r.layer === 1)?.expertOverlap).toBe(0.5);
    expect(result.find((r) => r.layer === 0)?.expertOverlap).toBe(1);
  });

  it('CD-05: Schritt mit sich selbst → alle Kosinus 1', () => {
    for (const row of layerDiff(stepAt(katze, 1), stepAt(katze, 1))) {
      expect(row.cosine).toBeCloseTo(1, 6);
    }
  });
});

describe('CD-06 Größter Abfall', () => {
  it('CD-06: Beispiele aus dem Contract', () => {
    expect(largestDrop(rows([0.99, 0.8, 0.78]))).toBe(1);
    expect(largestDrop(rows([0.7, 0.69]))).toBe(0);
    expect(largestDrop(rows([1, 1, 1]))).toBeNull();
    expect(largestDrop([])).toBeNull();
    expect(largestDrop(rows([0.9, 0.8]))).toBe(0);
  });

  it('CD-06: liefert layer der Zeile, nicht den Index', () => {
    const shifted = rows([0.95, 0.5]).map((row) => ({ ...row, layer: row.layer + 3 }));
    expect(largestDrop(shifted)).toBe(4);
  });

  it('CD-06: Abfall bis 1e-6 zählt nicht', () => {
    expect(largestDrop(rows([1 - 1e-7, 1 - 2e-7]))).toBeNull();
  });
});

describe('CD-07 Unveränderte Traces und Tempo', () => {
  it('CD-07: Aufrufe verändern die Traces nicht', () => {
    const before = [serializeTrace(katze), serializeTrace(hund)];
    comparability(katze, hund);
    for (const index of [0, 1]) {
      outputDiff(stepAt(katze, index), stepAt(hund, index));
      layerDiff(stepAt(katze, index), stepAt(hund, index));
    }
    expect([serializeTrace(katze), serializeTrace(hund)]).toEqual(before);
  });

  it('CD-07: layerDiff zweier 24-Layer-Traces unter 100 ms', () => {
    const trace = deserializeTrace(
      JSON.stringify(buildMoeTrace({ layers: 24, experts: 8, topK: 2 })),
    );
    const step = stepAt(trace, 0);
    layerDiff(step, step);
    const start = performance.now();
    const result = layerDiff(step, step);
    expect(performance.now() - start).toBeLessThan(100);
    expect(result).toHaveLength(24);
  });
});
