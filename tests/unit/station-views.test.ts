// TST-0018 · CON-0017: reine Rechnungen der Stationsansichten (V-01 bis V-08).
import { describe, expect, it } from 'vitest';

import type {
  AttentionStation,
  EmbedStation,
  GenerationStep,
  ResidualStation,
  Station,
  Tensor,
} from '@/trace/types';
import {
  countPositive,
  extent,
  l2Norm,
  maxAbs,
  tensorRow,
  topActivations,
} from '@/views/tensor/tensor-math';
import { divergingPosition, sampleScale, type ScaleStop } from '@/views/tensor/color-scale';
import { attentionMatrix, topAttended } from '@/views/tensor/attention-matrix';
import { residualTrajectory } from '@/views/tensor/residual-trajectory';
import { COLORS, DATA_SCALE, DIVERGING_SCALE } from '@/app/theme/tokens';

import { freshSetup, run, stepAt } from './helpers/engine-setup';

function tensor(shape: number[], values: number[]): Tensor {
  return { shape, dtype: 'float32', data: Float32Array.from(values) };
}

function token(id: number): { id: number; text: string } {
  return { id, text: `t${id}` };
}

/** attention-Station mit Gewichten [H, e, b]; `rows[h][r]` = Zeile r von Kopf h (Länge b). */
function attention(layer: number, rows: number[][][]): AttentionStation {
  const heads = rows.length;
  const e = rows[0]?.length ?? 0;
  const b = rows[0]?.[0]?.length ?? 0;
  const empty = tensor([e, 2], new Array<number>(e * 2).fill(0));
  return {
    kind: 'attention',
    layer,
    lnIn: empty,
    q: empty,
    k: empty,
    v: empty,
    weights: tensor([heads, e, b], rows.flat(2)),
    out: empty,
  };
}

function step(index: number, newPositions: [number, number], stations: Station[]): GenerationStep {
  return {
    index,
    contextTokens: Array.from({ length: newPositions[1] }, (_, i) => token(i)),
    newPositions,
    stations,
    chosen: token(99),
    text: 'x',
  };
}

// Schritt 0: Positionen 0..2, zwei Köpfe; Schritt 1: Position 3; Schritt 2: Position 4.
const STEP0 = step(
  0,
  [0, 3],
  [
    attention(0, [
      [
        [1, 0, 0],
        [0.25, 0.75, 0],
        [0.2, 0.3, 0.5],
      ],
      [
        [1, 0, 0],
        [0.75, 0.25, 0],
        [0.6, 0.1, 0.3],
      ],
    ]),
    attention(1, [
      [
        [1, 0, 0],
        [0.5, 0.5, 0],
        [0.1, 0.1, 0.8],
      ],
      [
        [1, 0, 0],
        [0.5, 0.5, 0],
        [0.4, 0.4, 0.2],
      ],
    ]),
  ],
);
const STEP1 = step(
  1,
  [3, 4],
  [
    attention(0, [[[0.1, 0.2, 0.3, 0.4]], [[0.4, 0.3, 0.2, 0.1]]]),
    attention(1, [[[0.25, 0.25, 0.25, 0.25]], [[0.7, 0.1, 0.1, 0.1]]]),
  ],
);
const STEP2 = step(
  2,
  [4, 5],
  [
    attention(0, [[[0.3, 0.3, 0.1, 0.1, 0.2]], [[0.1, 0.1, 0.1, 0.1, 0.6]]]),
    attention(1, [[[0.2, 0.2, 0.2, 0.2, 0.2]], [[0.2, 0.2, 0.2, 0.2, 0.2]]]),
  ],
);

function rowOf(values: Float32Array, cols: number, r: number): number[] {
  return Array.from(values.subarray(r * cols, (r + 1) * cols));
}

function expectRowClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? Number.NaN, 6));
}

describe('V-01 Zeilen eines Tensors', () => {
  const t = tensor([2, 3], [1, 2, 3, 4, 5, 6]);

  it('V-01: liefert die Zeile row-major', () => {
    expect(Array.from(tensorRow(t, 0))).toEqual([1, 2, 3]);
    expect(Array.from(tensorRow(t, 1))).toEqual([4, 5, 6]);
    expect(tensorRow(t, 1)).toBeInstanceOf(Float32Array);
  });

  it('V-01: liefert eine Kopie', () => {
    const row = tensorRow(t, 1);
    row[0] = 99;
    expect(t.data[3]).toBe(4);
  });

  it('V-01: ungültige Zeile oder Form → RangeError', () => {
    expect(() => tensorRow(t, -1)).toThrow(RangeError);
    expect(() => tensorRow(t, 2)).toThrow(RangeError);
    expect(() => tensorRow(t, 0.5)).toThrow(RangeError);
    expect(() => tensorRow(tensor([6], [1, 2, 3, 4, 5, 6]), 0)).toThrow(RangeError);
    expect(() => tensorRow(tensor([1, 2, 3], [1, 2, 3, 4, 5, 6]), 0)).toThrow(RangeError);
  });
});

describe('V-02 Statistik eines Vektors', () => {
  it('V-02: Norm, Extent, maxAbs, countPositive', () => {
    const v = [3, -4, 0, 0];
    expect(l2Norm(v)).toBeCloseTo(5, 12);
    expect(extent(v)).toEqual({ min: -4, max: 3 });
    expect(maxAbs(v)).toBe(4);
    expect(countPositive(v)).toBe(1);
    expect(countPositive(Float32Array.from([0, 0.5, -0.5, 2]))).toBe(2);
  });

  it('V-02: leere Vektoren', () => {
    expect(l2Norm([])).toBe(0);
    expect(extent([])).toEqual({ min: 0, max: 0 });
    expect(maxAbs([])).toBe(0);
    expect(countPositive([])).toBe(0);
  });

  it('V-02: Norm in Float64 (keine Float32-Rundung)', () => {
    // 1e40 als Quadrat läge außerhalb von Float32; erwartet relativ zum gespeicherten Wert.
    const v = Float32Array.from([1e20, 1e20]);
    expect(l2Norm(v) / (Math.SQRT2 * (v[0] ?? 0))).toBeCloseTo(1, 12);
  });

  it('V-02: topActivations absteigend, Gleichstand kleinerer Index zuerst', () => {
    expect(topActivations([1, 3, 3, -2], 3)).toEqual([
      { index: 1, value: 3 },
      { index: 2, value: 3 },
      { index: 0, value: 1 },
    ]);
    expect(topActivations([1, 2], 5)).toEqual([
      { index: 1, value: 2 },
      { index: 0, value: 1 },
    ]);
    expect(topActivations([1, 2], 0)).toEqual([]);
  });

  it('V-02: topActivations mit ungültigem n → RangeError', () => {
    expect(() => topActivations([1, 2], -1)).toThrow(RangeError);
    expect(() => topActivations([1, 2], 1.5)).toThrow(RangeError);
  });
});

describe('V-03 Farbskala', () => {
  const STOPS: ScaleStop[] = [
    { at: 0, color: '#000000' },
    { at: 1, color: '#ff8000' },
  ];

  it('V-03: lineare Interpolation je Kanal mit Math.round', () => {
    expect(sampleScale(STOPS, 0.5)).toBe('#804000');
    expect(sampleScale(STOPS, 0.25)).toBe('#402000');
  });

  it('V-03: Ränder und Begrenzung', () => {
    expect(sampleScale(STOPS, 0)).toBe('#000000');
    expect(sampleScale(STOPS, 1)).toBe('#ff8000');
    expect(sampleScale(STOPS, -3)).toBe('#000000');
    expect(sampleScale(STOPS, 7)).toBe('#ff8000');
    expect(sampleScale(STOPS, Number.NaN)).toBe('#000000');
  });

  it('V-03: Stopps innerhalb von [0, 1] und mehrere Abschnitte', () => {
    const stops: ScaleStop[] = [
      { at: 0.2, color: '#102030' },
      { at: 0.6, color: '#506070' },
      { at: 0.8, color: '#ffffff' },
    ];
    expect(sampleScale(stops, 0.1)).toBe('#102030');
    expect(sampleScale(stops, 0.4)).toBe('#304050');
    expect(sampleScale(stops, 0.9)).toBe('#ffffff');
  });

  it('V-03: gleiche at → harte Kante, der letzte Stopp gilt', () => {
    const stops: ScaleStop[] = [
      { at: 0, color: '#000000' },
      { at: 0.5, color: '#ff0000' },
      { at: 0.5, color: '#00ff00' },
      { at: 1, color: '#0000ff' },
    ];
    expect(sampleScale(stops, 0.5)).toBe('#00ff00');
    expect(sampleScale(stops, 0.25)).toBe('#800000');
  });

  it('V-03: leere Stopps → RangeError', () => {
    expect(() => sampleScale([], 0.5)).toThrow(RangeError);
  });

  it('V-03: Theme-Skalen an ihren Stopps', () => {
    for (const stop of DATA_SCALE) expect(sampleScale(DATA_SCALE, stop.at)).toBe(stop.color);
    expect(sampleScale(DATA_SCALE, 0)).toBe(COLORS.surface);
    expect(sampleScale(DATA_SCALE, 1)).toBe(COLORS.mint);
    expect(sampleScale(DATA_SCALE, 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('V-04 Divergierende Position', () => {
  it('V-04: Beispiele aus dem Contract', () => {
    expect(divergingPosition(1, 2)).toBeCloseTo(0.75, 12);
    expect(divergingPosition(-2, 2)).toBe(0);
    expect(divergingPosition(5, 2)).toBe(1);
    expect(divergingPosition(3, 0)).toBe(0.5);
    expect(divergingPosition(0, 4)).toBe(0.5);
    expect(divergingPosition(1, -1)).toBe(0.5);
  });
});

describe('V-05 Divergierende Skala im Theme', () => {
  it('V-05: violet → surface-2 → mint', () => {
    expect(DIVERGING_SCALE).toEqual([
      { at: 0, color: COLORS.violet },
      { at: 0.5, color: COLORS['surface-2'] },
      { at: 1, color: COLORS.mint },
    ]);
    expect(sampleScale(DIVERGING_SCALE, divergingPosition(0, 3))).toBe(COLORS['surface-2']);
    expect(sampleScale(DIVERGING_SCALE, divergingPosition(-3, 3))).toBe(COLORS.violet);
    expect(sampleScale(DIVERGING_SCALE, divergingPosition(3, 3))).toBe(COLORS.mint);
  });
});

describe('V-06 Attention-Matrix', () => {
  it('V-06: Schritt 0, ein Kopf, kausal', () => {
    const m = attentionMatrix(STEP0, [], 0, 1, true);
    if (m === null) throw new Error('Matrix fehlt');
    expect(m.rows).toEqual([0, 1, 2]);
    expect(m.cols).toBe(3);
    expect(m.current).toEqual([0, 3]);
    expectRowClose(rowOf(m.values, 3, 0), [1, 0, 0]);
    expectRowClose(rowOf(m.values, 3, 1), [0.75, 0.25, 0]);
    expectRowClose(rowOf(m.values, 3, 2), [0.6, 0.1, 0.3]);
  });

  it('V-06: Mittel über alle Köpfe', () => {
    const m = attentionMatrix(STEP0, [], 0, 'mean', false);
    if (m === null) throw new Error('Matrix fehlt');
    expectRowClose(rowOf(m.values, 3, 1), [0.5, 0.5, 0]);
    expectRowClose(rowOf(m.values, 3, 2), [0.4, 0.2, 0.4]);
  });

  it('V-06: Folgeschritt mit früheren Zeilen (history = true)', () => {
    const m = attentionMatrix(STEP2, [STEP0, STEP1], 0, 0, true);
    if (m === null) throw new Error('Matrix fehlt');
    expect(m.rows).toEqual([0, 1, 2, 3, 4]);
    expect(m.cols).toBe(5);
    expect(m.current).toEqual([4, 5]);
    expectRowClose(rowOf(m.values, 5, 0), [1, 0, 0, 0, 0]);
    expectRowClose(rowOf(m.values, 5, 2), [0.2, 0.3, 0.5, 0, 0]);
    expectRowClose(rowOf(m.values, 5, 3), [0.1, 0.2, 0.3, 0.4, 0]);
    expectRowClose(rowOf(m.values, 5, 4), [0.3, 0.3, 0.1, 0.1, 0.2]);
  });

  it('V-06: Folgeschritt ohne frühere Zeilen (history = false)', () => {
    const m = attentionMatrix(STEP2, [STEP0, STEP1], 1, 1, false);
    if (m === null) throw new Error('Matrix fehlt');
    expect(m.rows).toEqual([4]);
    expect(m.cols).toBe(5);
    expect(m.current).toEqual([0, 1]);
    expectRowClose(rowOf(m.values, 5, 0), [0.2, 0.2, 0.2, 0.2, 0.2]);
  });

  it('V-06: Schritt ohne passende Station trägt nichts bei', () => {
    const gap = step(1, [3, 4], []);
    const m = attentionMatrix(STEP2, [STEP0, gap], 0, 0, true);
    if (m === null) throw new Error('Matrix fehlt');
    expect(m.rows).toEqual([0, 1, 2, 4]);
    expect(m.current).toEqual([3, 4]);
    expectRowClose(rowOf(m.values, 5, 3), [0.3, 0.3, 0.1, 0.1, 0.2]);
  });

  it('V-06: jede Position höchstens einmal, das erste Vorkommen gilt', () => {
    const replay = step(
      0,
      [0, 3],
      [
        attention(0, [
          [
            [1, 0, 0],
            [0.9, 0.1, 0],
            [0.9, 0.05, 0.05],
          ],
          [
            [1, 0, 0],
            [0.9, 0.1, 0],
            [0.9, 0.05, 0.05],
          ],
        ]),
      ],
    );
    const m = attentionMatrix(STEP1, [STEP0, replay], 0, 0, true);
    if (m === null) throw new Error('Matrix fehlt');
    expect(m.rows).toEqual([0, 1, 2, 3]);
    expectRowClose(rowOf(m.values, 4, 1), [0.25, 0.75, 0, 0]);
  });

  it('V-06: fehlende Station → null, ungültiger Kopf → RangeError', () => {
    expect(attentionMatrix(STEP0, [], 5, 0, true)).toBeNull();
    expect(() => attentionMatrix(STEP0, [], 0, 2, true)).toThrow(RangeError);
    expect(() => attentionMatrix(STEP0, [], 0, -1, true)).toThrow(RangeError);
    expect(() => attentionMatrix(STEP0, [], 0, 0.5, true)).toThrow(RangeError);
  });

  it('V-06: Form passt nicht zu newPositions → RangeError', () => {
    const broken = step(
      1,
      [3, 5],
      [attention(0, [[[0.1, 0.2, 0.3, 0.4]], [[0.4, 0.3, 0.2, 0.1]]])],
    );
    expect(() => attentionMatrix(broken, [STEP0], 0, 0, true)).toThrow(RangeError);
  });

  it('V-06: Eingaben bleiben unverändert', () => {
    const before = Array.from(
      STEP0.stations[0]?.kind === 'attention' ? STEP0.stations[0].weights.data : [],
    );
    attentionMatrix(STEP2, [STEP0, STEP1], 0, 'mean', true);
    const after = Array.from(
      STEP0.stations[0]?.kind === 'attention' ? STEP0.stations[0].weights.data : [],
    );
    expect(after).toEqual(before);
  });

  it('V-06: Lauf der MockEngine – frühere Zeilen stammen aus den früheren Schritten', async () => {
    const setup = await freshSetup();
    const trace = (await run(setup, 'die katze sitzt', 3)).trace;
    const s0 = stepAt(trace, 0);
    const s2 = stepAt(trace, 2);
    const full = attentionMatrix(s2, [s0, stepAt(trace, 1)], 1, 0, true);
    const first = attentionMatrix(s0, [], 1, 0, true);
    if (full === null || first === null) throw new Error('Matrix fehlt');
    expect(full.rows).toEqual([0, 1, 2, 3, 4]);
    for (let r = 0; r < first.rows.length; r += 1) {
      expectRowClose(
        rowOf(full.values, full.cols, r).slice(0, first.cols),
        rowOf(first.values, first.cols, r),
      );
    }
    for (let r = 0; r < full.rows.length; r += 1) {
      const row = rowOf(full.values, full.cols, r);
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      row.slice((full.rows[r] ?? 0) + 1).forEach((v) => expect(v).toBe(0));
    }
  });
});

describe('V-07 Am stärksten beachtete Positionen', () => {
  const m = attentionMatrix(STEP2, [STEP0, STEP1], 0, 0, true);

  it('V-07: absteigend, Gleichstand kleinere Position zuerst, nur Spalten bis zur Zeile', () => {
    if (m === null) throw new Error('Matrix fehlt');
    const top = topAttended(m, 4, 3);
    expect(top.map((t) => t.position)).toEqual([0, 1, 4]);
    expect(top[0]?.weight).toBeCloseTo(0.3, 6);
    expect(top[2]?.weight).toBeCloseTo(0.2, 6);
    expect(topAttended(m, 0, 3)).toEqual([{ position: 0, weight: 1 }]);
    expect(topAttended(m, 2, 0)).toEqual([]);
  });

  it('V-07: ungültige Zeile oder n → RangeError', () => {
    if (m === null) throw new Error('Matrix fehlt');
    expect(() => topAttended(m, 5, 3)).toThrow(RangeError);
    expect(() => topAttended(m, -1, 3)).toThrow(RangeError);
    expect(() => topAttended(m, 0, -2)).toThrow(RangeError);
    expect(() => topAttended(m, 0, 1.5)).toThrow(RangeError);
  });
});

describe('V-08 Verlauf des Residual Stream', () => {
  const embed: EmbedStation = {
    kind: 'embed',
    token: tensor([2, 2], [0, 0, 0, 0]),
    position: tensor([2, 2], [0, 0, 0, 0]),
    sum: tensor([2, 2], [3, 4, 1, 0]),
  };
  const residual = (
    layer: number,
    after: 'attention' | 'mlp',
    values: number[],
  ): ResidualStation => ({
    kind: 'residual',
    layer,
    after,
    stream: tensor([2, 2], values),
  });
  const stations: Station[] = [
    { kind: 'tokenize', tokens: [token(0), token(1)] },
    embed,
    attention(0, [
      [
        [1, 0],
        [0.5, 0.5],
      ],
    ]),
    residual(0, 'attention', [6, 8, 1, 1]),
    residual(0, 'mlp', [6, 8, 0, 1]),
  ];

  it('V-08: Einträge in Stationsreihenfolge mit Norm und Änderung', () => {
    expect(residualTrajectory(stations, 0)).toEqual([
      { stationIndex: 1, kind: 'embed', layer: null, after: null, norm: 5, delta: null },
      { stationIndex: 3, kind: 'residual', layer: 0, after: 'attention', norm: 10, delta: 5 },
      { stationIndex: 4, kind: 'residual', layer: 0, after: 'mlp', norm: 10, delta: 0 },
    ]);
    const second = residualTrajectory(stations, 1);
    expect(second.map((e) => e.norm)).toEqual([1, Math.SQRT2, 1]);
    expect(second.map((e) => e.delta)).toEqual([null, 1, 1]);
  });

  it('V-08: ohne embed beginnt der Verlauf mit delta null', () => {
    const entries = residualTrajectory(stations.slice(2), 0);
    expect(entries[0]).toMatchObject({ stationIndex: 1, kind: 'residual', delta: null });
  });

  it('V-08: fehlende Zeile → RangeError, keine passenden Stationen → []', () => {
    expect(() => residualTrajectory(stations, 2)).toThrow(RangeError);
    expect(residualTrajectory([{ kind: 'tokenize', tokens: [] }], 0)).toEqual([]);
  });

  it('V-08: Lauf der MockEngine – delta nach der Attention ist die Norm von attention.out', async () => {
    const setup = await freshSetup();
    const trace = (await run(setup, 'die katze sitzt', 1)).trace;
    const s0 = stepAt(trace, 0);
    const entries = residualTrajectory(s0.stations, 2);
    const layers = trace.engine.architecture?.nLayers ?? 0;
    expect(entries).toHaveLength(1 + 2 * layers);
    const firstAttention = s0.stations.find(
      (s): s is AttentionStation => s.kind === 'attention' && s.layer === 0,
    );
    if (firstAttention === undefined) throw new Error('attention fehlt');
    expect(entries[1]?.delta).toBeCloseTo(l2Norm(tensorRow(firstAttention.out, 2)), 4);
    entries.forEach((entry) => expect(s0.stations[entry.stationIndex]?.kind).toBe(entry.kind));
  });
});
