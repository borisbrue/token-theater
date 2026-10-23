// TST-0020 · CON-0019: Rechenkern der GPT-2-Engine (K-01 bis K-07), JS- und WASM-Kern.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import wabtInit from 'wabt';
import { beforeAll, describe, expect, it } from 'vitest';

import { createRng } from '@/engine/rng';
import { parseSafetensors } from '@/engine/gpt2/safetensors';
import { parseGpt2Config, type Gpt2Config } from '@/engine/gpt2/config';
import { mapGpt2Weights, type Gpt2Weights } from '@/engine/gpt2/weights';
import { affine as mathAffine } from '@/engine/gpt2/math';
import {
  createJsKernel,
  createWasmKernel,
  selectKernel,
  wasmSimdSupported,
  type KernelSetup,
} from '@/engine/gpt2/kernel';
import { KERNEL_WASM_BASE64 } from '@/engine/gpt2/kernel-wasm';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDir = join(repoRoot, 'tests/fixtures/gpt2');
const readBuffer = (name: string): ArrayBuffer => {
  const bytes = readFileSync(join(fixtureDir, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const FOREIGN = 'Die Gewichte gehören nicht zu diesem Rechenkern.';

const SYNTH: Gpt2Config = {
  nLayers: 1,
  nHeads: 12,
  dModel: 768,
  dMlp: 3072,
  vocabSize: 100,
  contextLength: 4,
  layerNormEpsilon: 1e-5,
};

const AFFINE_SIZES: readonly [number, number, number][] = [
  [1, 1, 1],
  [3, 5, 7],
  [2, 13, 9],
  [4, 8, 24],
  [1, 768, 2304],
  [2, 3072, 768],
];
const UNEMBED_SIZES: readonly [number, number][] = [
  [1, 1],
  [5, 3],
  [7, 8],
  [9, 13],
  [100, 768],
];

function randomArray(length: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = rng.next() * 2 - 1;
  return out;
}

/** Gewichte mit der Struktur aus CON-0014 und Zufallswerten. */
function syntheticWeights(config: Gpt2Config, seed: number): Gpt2Weights {
  const { dModel: d, dMlp: m } = config;
  let next = seed;
  const take = (length: number): Float32Array => randomArray(length, (next += 1));
  const norm = () => ({ g: take(d), b: take(d) });
  const affine = (inputs: number, outputs: number) => ({
    w: take(inputs * outputs),
    b: take(outputs),
  });
  return {
    wte: take(config.vocabSize * d),
    wpe: take(config.contextLength * d),
    layers: Array.from({ length: config.nLayers }, () => ({
      ln1: norm(),
      attn: affine(d, 3 * d),
      attnProj: affine(d, d),
      ln2: norm(),
      fc: affine(d, m),
      mlpProj: affine(m, d),
    })),
    lnF: norm(),
  };
}

function allTensors(weights: Gpt2Weights): Float32Array[] {
  return [
    weights.wte,
    weights.wpe,
    weights.lnF.g,
    weights.lnF.b,
    ...weights.layers.flatMap((l) => [
      l.ln1.g,
      l.ln1.b,
      l.attn.w,
      l.attn.b,
      l.attnProj.w,
      l.attnProj.b,
      l.ln2.g,
      l.ln2.b,
      l.fc.w,
      l.fc.b,
      l.mlpProj.w,
      l.mlpProj.b,
    ]),
  ];
}

function layer0(setup: KernelSetup) {
  const layer = setup.weights.layers[0];
  if (layer === undefined) throw new Error('Layer 0 fehlt');
  return layer;
}

/** Testmatrizen als Anfangsstücke der Gewichte des Setups (CON-0019, Kopf). */
function affineOperands(setup: KernelSetup, rows: number, inputs: number, outputs: number) {
  const fc = layer0(setup).fc;
  return {
    x: randomArray(rows * inputs, 1000 + rows * 31 + inputs * 7 + outputs),
    w: fc.w.subarray(0, inputs * outputs),
    b: fc.b.subarray(0, outputs),
  };
}

function unembedOperands(setup: KernelSetup, n: number, k: number) {
  return { h: randomArray(k, 2000 + n * 13 + k), e: setup.weights.wte.subarray(0, n * k) };
}

/** Σ|xw| je affine-Ausgabe (mit |b|). */
function affineMagnitude(
  x: Float32Array,
  rows: number,
  inputs: number,
  w: Float32Array,
  b: Float32Array,
  outputs: number,
): Float64Array {
  const out = new Float64Array(rows * outputs);
  for (let r = 0; r < rows; r += 1) {
    for (let o = 0; o < outputs; o += 1) {
      let s = Math.abs(b[o] ?? 0);
      for (let i = 0; i < inputs; i += 1) {
        s += Math.abs((x[r * inputs + i] ?? 0) * (w[i * outputs + o] ?? 0));
      }
      out[r * outputs + o] = s;
    }
  }
  return out;
}

let js: KernelSetup;
let wasm: KernelSetup;
let synthWeights: Gpt2Weights;
let tinyConfig: Gpt2Config;
let tinyWeights: Gpt2Weights;

beforeAll(() => {
  synthWeights = syntheticWeights(SYNTH, 20261022);
  js = createJsKernel(SYNTH, synthWeights);
  wasm = createWasmKernel(SYNTH, synthWeights);
  tinyConfig = parseGpt2Config(
    JSON.parse(readFileSync(join(fixtureDir, 'tiny-gpt2.config.json'), 'utf8')) as unknown,
  );
  tinyWeights = mapGpt2Weights(parseSafetensors(readBuffer('tiny-gpt2.safetensors')), tinyConfig);
});

/** Kernnamen für it.each; die Setups entstehen erst in beforeAll. */
const BOTH = ['js', 'wasm-simd'] as const;
const setupOf = (name: (typeof BOTH)[number]): KernelSetup => (name === 'js' ? js : wasm);

describe('K-01 JS-Kern', () => {
  it('K-01: Name und Gewichte', () => {
    expect(js.kernel.name).toBe('js');
    expect(js.weights).toBe(synthWeights);
  });

  it.each(AFFINE_SIZES)('K-01: affine %i × %i → %i bitgleich mit math.affine', (r, i, o) => {
    const { x, w, b } = affineOperands(js, r, i, o);
    const got = js.kernel.affine(x, r, i, w, b, o);
    expect(got).toBeInstanceOf(Float32Array);
    expect(got).toHaveLength(r * o);
    expect(Array.from(got)).toEqual(Array.from(mathAffine(x, r, i, w, b, o)));
  });

  it.each(UNEMBED_SIZES)('K-01: unembed n = %i, k = %i in double, Ergebnis fround', (n, k) => {
    const { h, e } = unembedOperands(js, n, k);
    const got = js.kernel.unembed(h, e, n, k);
    expect(got).toBeInstanceOf(Float32Array);
    expect(got).toHaveLength(n);
    for (let t = 0; t < n; t += 1) {
      let dot = 0;
      for (let c = 0; c < k; c += 1) dot += (h[c] ?? 0) * (e[t * k + c] ?? 0);
      expect(got[t]).toBe(Math.fround(dot));
    }
  });

  it('K-01: rows = 0 und n = 0 ergeben leere Arrays', () => {
    const { x, w, b } = affineOperands(js, 1, 3, 4);
    expect(js.kernel.affine(x, 0, 3, w, b, 4)).toEqual(new Float32Array(0));
    const { h, e } = unembedOperands(js, 1, 3);
    expect(js.kernel.unembed(h, e, 0, 3)).toEqual(new Float32Array(0));
  });
});

describe('K-02 Gemeinsame Vorbedingungen', () => {
  it.each(BOTH)('K-02 %s: fremde Gewichte werden abgelehnt', (name) => {
    const setup = setupOf(name);
    const { x, w, b } = affineOperands(setup, 1, 4, 4);
    const { h, e } = unembedOperands(setup, 2, 3);
    expect(() => setup.kernel.affine(x, 1, 4, new Float32Array(16), b, 4)).toThrow(FOREIGN);
    expect(() => setup.kernel.affine(x, 1, 4, w, new Float32Array(4), 4)).toThrow(FOREIGN);
    expect(() => setup.kernel.unembed(h, new Float32Array(6), 2, 3)).toThrow(FOREIGN);
    // Teilstücke der eigenen Gewichte und beliebige x/h sind erlaubt.
    expect(() => setup.kernel.affine(x, 1, 4, w, b, 4)).not.toThrow();
    expect(() => setup.kernel.unembed(h, e, 2, 3)).not.toThrow();
  });

  it('K-02 wasm-simd: Gewichte des JS-Setups gelten als fremd', () => {
    const own = affineOperands(wasm, 1, 4, 4);
    const foreign = affineOperands(js, 1, 4, 4);
    expect(() => wasm.kernel.affine(own.x, 1, 4, foreign.w, own.b, 4)).toThrow(FOREIGN);
    expect(() => wasm.kernel.unembed(own.x, js.weights.wte, 1, 4)).toThrow(FOREIGN);
  });

  it.each(BOTH)('K-02 %s: ungültige Größen und zu kurze Arrays', (name) => {
    const setup = setupOf(name);
    const { x, w, b } = affineOperands(setup, 2, 4, 4);
    const { h, e } = unembedOperands(setup, 2, 3);
    const k = setup.kernel;
    expect(() => k.affine(x, -1, 4, w, b, 4)).toThrow(RangeError);
    expect(() => k.affine(x, 1.5, 4, w, b, 4)).toThrow(RangeError);
    expect(() => k.affine(x, 2, Number.NaN, w, b, 4)).toThrow(RangeError);
    expect(() => k.affine(x.subarray(0, 7), 2, 4, w, b, 4)).toThrow(RangeError);
    expect(() => k.affine(x, 2, 4, w.subarray(0, 15), b, 4)).toThrow(RangeError);
    expect(() => k.affine(x, 2, 4, w, b.subarray(0, 3), 4)).toThrow(RangeError);
    expect(() => k.unembed(h.subarray(0, 2), e, 2, 3)).toThrow(RangeError);
    expect(() => k.unembed(h, e.subarray(0, 5), 2, 3)).toThrow(RangeError);
    expect(() => k.unembed(h, e, -2, 3)).toThrow(RangeError);
    // Längere Arrays sind erlaubt.
    expect(k.affine(x, 1, 4, w, b, 4)).toHaveLength(4);
  });

  it.each(BOTH)('K-02 %s: Kapazität aus der Konfiguration', (name) => {
    const setup = setupOf(name);
    const k = setup.kernel;
    const fc = layer0(setup).fc;
    // 5 · 3072 = 15 360 Eingaben > 4 · max(768, 3072) = 12 288
    const x = randomArray(5 * 3072, 7);
    expect(() => k.affine(x, 5, 3072, fc.w.subarray(0, 3072), fc.b.subarray(0, 1), 1)).toThrow(
      RangeError,
    );
    // 4 · 3072 = 12 288 Eingaben passen genau.
    expect(k.affine(x, 4, 3072, fc.w.subarray(0, 3072), fc.b.subarray(0, 1), 1)).toHaveLength(4);
    // 12 289 Ausgaben > max(4 · max(2304, 3072), 100) = 12 288
    const h = randomArray(1, 8);
    expect(() => k.unembed(h, setup.weights.wte.subarray(0, 12289), 12289, 1)).toThrow(RangeError);
    expect(k.unembed(h, setup.weights.wte.subarray(0, 12288), 12288, 1)).toHaveLength(12288);
  });

  it.each(BOTH)('K-02 %s: frische Ergebnisse ohne gemeinsamen Puffer', (name) => {
    const setup = setupOf(name);
    const buffers = new Set<ArrayBufferLike>(allTensors(setup.weights).map((t) => t.buffer));
    const first = affineOperands(setup, 2, 8, 24);
    const a = setup.kernel.affine(first.x, 2, 8, first.w, first.b, 24);
    const copy = Array.from(a);
    expect(buffers.has(a.buffer)).toBe(false);
    setup.kernel.affine(randomArray(16, 99), 2, 8, first.w, first.b, 24);
    expect(Array.from(a)).toEqual(copy);

    const u = unembedOperands(setup, 9, 13);
    const p = setup.kernel.unembed(u.h, u.e, 9, 13);
    const pCopy = Array.from(p);
    expect(buffers.has(p.buffer)).toBe(false);
    setup.kernel.unembed(randomArray(13, 98), u.e, 9, 13);
    expect(Array.from(p)).toEqual(pCopy);
  });
});

describe('K-03 WASM-Kern gegen JS-Kern', () => {
  it('K-03: Name', () => {
    expect(wasm.kernel.name).toBe('wasm-simd');
  });

  it.each(AFFINE_SIZES)('K-03: affine %i × %i → %i innerhalb der Toleranz', (r, i, o) => {
    const ops = affineOperands(wasm, r, i, o);
    const ref = affineOperands(js, r, i, o);
    const got = wasm.kernel.affine(ops.x, r, i, ops.w, ops.b, o);
    const want = js.kernel.affine(ref.x, r, i, ref.w, ref.b, o);
    const magnitude = affineMagnitude(ref.x, r, i, ref.w, ref.b, o);
    expect(got).toHaveLength(r * o);
    got.forEach((v, idx) => {
      const tol = 2 ** -16 * (magnitude[idx] ?? 0) + 1e-7;
      expect(Math.abs(v - (want[idx] ?? NaN)), `[${idx}]`).toBeLessThanOrEqual(tol);
    });
  });

  it.each(UNEMBED_SIZES)('K-03: unembed n = %i, k = %i innerhalb der Toleranz', (n, k) => {
    const ops = unembedOperands(wasm, n, k);
    const ref = unembedOperands(js, n, k);
    const got = wasm.kernel.unembed(ops.h, ops.e, n, k);
    const want = js.kernel.unembed(ref.h, ref.e, n, k);
    expect(got).toHaveLength(n);
    for (let t = 0; t < n; t += 1) {
      let magnitude = 0;
      for (let c = 0; c < k; c += 1)
        magnitude += Math.abs((ref.h[c] ?? 0) * (ref.e[t * k + c] ?? 0));
      expect(Math.abs((got[t] ?? NaN) - (want[t] ?? NaN)), `[${t}]`).toBeLessThanOrEqual(
        2 ** -16 * magnitude + 1e-7,
      );
    }
  });

  it('K-03: rows = 0 und n = 0 ergeben leere Arrays', () => {
    const { x, w, b } = affineOperands(wasm, 1, 3, 4);
    expect(wasm.kernel.affine(x, 0, 3, w, b, 4)).toEqual(new Float32Array(0));
    const { h, e } = unembedOperands(wasm, 1, 3);
    expect(wasm.kernel.unembed(h, e, 0, 3)).toEqual(new Float32Array(0));
  });
});

describe('K-04 Gewichte im WASM-Speicher', () => {
  it('K-04: gleiche Struktur und Werte, ein ausgerichteter Puffer, Eingabe unverändert', () => {
    const before = allTensors(tinyWeights).map((t) => Array.from(t));
    const inputBuffers = new Set<ArrayBufferLike>(allTensors(tinyWeights).map((t) => t.buffer));
    const setup = createWasmKernel(tinyConfig, tinyWeights);
    expect(setup.kernel.name).toBe('wasm-simd');
    expect(setup.weights.layers).toHaveLength(tinyWeights.layers.length);
    const moved = allTensors(setup.weights);
    const original = allTensors(tinyWeights);
    expect(moved).toHaveLength(original.length);
    const buffer = setup.weights.wte.buffer;
    expect(inputBuffers.has(buffer)).toBe(false);
    moved.forEach((t, i) => {
      expect(t).toBeInstanceOf(Float32Array);
      expect(t.buffer).toBe(buffer);
      expect(t.byteOffset % 16).toBe(0);
      expect(t).toHaveLength(original[i]?.length ?? -1);
      expect(Array.from(t)).toEqual(Array.from(original[i] ?? []));
    });
    expect(allTensors(tinyWeights).map((t) => Array.from(t))).toEqual(before);
  });
});

describe('K-05 Kein Wachstum', () => {
  it('K-05: derselbe Speicher nach vielen Aufrufen', () => {
    const buffer = wasm.weights.wte.buffer;
    const byteLength = buffer.byteLength;
    for (const [r, i, o] of AFFINE_SIZES) {
      const { x, w, b } = affineOperands(wasm, r, i, o);
      wasm.kernel.affine(x, r, i, w, b, o);
    }
    for (const [n, k] of UNEMBED_SIZES) {
      const { h, e } = unembedOperands(wasm, n, k);
      wasm.kernel.unembed(h, e, n, k);
    }
    expect(wasm.weights.wte.buffer).toBe(buffer);
    expect(buffer.byteLength).toBe(byteLength);
    expect(wasm.weights.wte).toHaveLength(SYNTH.vocabSize * SYNTH.dModel);
    expect(layer0(wasm).fc.w).toHaveLength(768 * 3072);
  });
});

describe('K-06 Auswahl', () => {
  const failing = (): KernelSetup => {
    throw new RangeError('zu wenig Speicher');
  };

  it('K-06: SIMD ist in Node verfügbar', () => {
    expect(wasmSimdSupported()).toBe(true);
  });

  it('K-06: js, wasm-simd und auto', () => {
    const asJs = selectKernel(tinyConfig, tinyWeights, 'js');
    expect(asJs.kernel.name).toBe('js');
    expect(asJs.weights).toBe(tinyWeights);

    const asWasm = selectKernel(tinyConfig, tinyWeights, 'wasm-simd');
    expect(asWasm.kernel.name).toBe('wasm-simd');
    expect(asWasm.weights.wte.buffer).not.toBe(tinyWeights.wte.buffer);
    expect(Array.from(asWasm.weights.wpe)).toEqual(Array.from(tinyWeights.wpe));

    expect(selectKernel(tinyConfig, tinyWeights, 'auto').kernel.name).toBe('wasm-simd');
    expect(selectKernel(tinyConfig, tinyWeights).kernel.name).toBe('wasm-simd');
  });

  it('K-06: Fehler beim Anlegen – wasm-simd wirft weiter, auto fällt auf JS zurück', () => {
    expect(() => selectKernel(tinyConfig, tinyWeights, 'wasm-simd', failing)).toThrow(
      'zu wenig Speicher',
    );
    const fallback = selectKernel(tinyConfig, tinyWeights, 'auto', failing);
    expect(fallback.kernel.name).toBe('js');
    expect(fallback.weights).toBe(tinyWeights);
  });
});

describe('K-07 Das Modul', () => {
  const bytes = (): Uint8Array => Uint8Array.from(atob(KERNEL_WASM_BASE64), (c) => c.charCodeAt(0));

  it('K-07: gültig, ein Import, zwei Exporte', () => {
    const module = bytes();
    expect(WebAssembly.validate(module)).toBe(true);
    const compiled = new WebAssembly.Module(module);
    expect(WebAssembly.Module.imports(compiled)).toEqual([
      { module: 'env', name: 'memory', kind: 'memory' },
    ]);
    const exports = WebAssembly.Module.exports(compiled)
      .map((e) => `${e.name}:${e.kind}`)
      .sort();
    expect(exports).toEqual(['affine:function', 'unembed:function']);
  });

  it('K-07: kernel.wat ohne memory.grow und ohne Drift zum eingecheckten Modul', async () => {
    const source = readFileSync(join(repoRoot, 'src/engine/gpt2/kernel.wat'), 'utf8');
    expect(source).not.toContain('memory.grow');
    const wabt = await wabtInit();
    const parsed = wabt.parseWat('kernel.wat', source, { simd: true, bulk_memory: true });
    try {
      const { buffer } = parsed.toBinary({});
      expect(Array.from(buffer)).toEqual(Array.from(bytes()));
    } finally {
      parsed.destroy();
    }
  }, 30_000);

  it('K-07: Build-Skript und devDependency', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.scripts?.['build:kernel']).toBe('node scripts/build-kernel.mjs');
    expect(pkg.devDependencies?.['wabt']).toBeDefined();
  });
});
