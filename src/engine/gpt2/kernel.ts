import type { Gpt2Config } from './config';
import { KERNEL_WASM_BASE64 } from './kernel-wasm';
import { affine as jsAffine } from './math';
import type { Affine, Gpt2Weights, Norm } from './weights';

/**
 * Rechenkern der GPT-2-Engine (SPEC-0008 §3.2–3.4, CON-0019): affine Schichten und
 * Vokabular-Projektion hinter einem Interface (Strategy). Der JS-Kern ist die bisherige Rechnung,
 * der WASM-Kern rechnet mit SIMD auf Gewichten in seinem eigenen Speicher (Adapter). Beide prüfen
 * dieselben Vorbedingungen, damit sie gegeneinander austauschbar sind.
 */

export type KernelName = 'wasm-simd' | 'js';

/**
 * Vorbedingungen (für alle Kerne gleich, sonst Fehler):
 * - w, b und e stammen aus den weights des KernelSetup, mit dem der Kern entstand (auch
 *   Teilstücke per subarray); sonst Error.
 * - Größen sind nicht negative ganze Zahlen, die Arrays lang genug und die Größen passen in die
 *   Kapazität aus der Konfiguration; sonst RangeError.
 * x und h dürfen beliebige Float32Arrays sein. Genauigkeit: JS-Kern bitgleich mit der bisherigen
 * Rechnung, andere Kerne innerhalb von 2⁻¹⁶ · Σ|x · w| + 1e-7 gegen den JS-Kern.
 */
export interface MatrixKernel {
  readonly name: KernelName;
  /** y = x · W + b; x [rows, inputs], W [inputs, outputs], b [outputs], row-major; neues Array. */
  affine(
    x: Float32Array,
    rows: number,
    inputs: number,
    w: Float32Array,
    b: Float32Array,
    outputs: number,
  ): Float32Array;
  /** out[t] = Σ_c h[c] · e[t · k + c] für t < n; e [n, k] row-major; neues Array. */
  unembed(h: Float32Array, e: Float32Array, n: number, k: number): Float32Array;
}

export interface KernelSetup {
  kernel: MatrixKernel;
  weights: Gpt2Weights;
}

const FOREIGN = 'Die Gewichte gehören nicht zu diesem Rechenkern.';
const ALIGN = 16;
const PAGE = 65536;

/** Alle Tensoren eines Gewichtssatzes in fester Reihenfolge. */
function tensorsOf(weights: Gpt2Weights): Float32Array[] {
  const norm = (n: Norm) => [n.g, n.b];
  const affine = (a: Affine) => [a.w, a.b];
  return [
    weights.wte,
    weights.wpe,
    ...norm(weights.lnF),
    ...weights.layers.flatMap((l) => [
      ...norm(l.ln1),
      ...affine(l.attn),
      ...affine(l.attnProj),
      ...norm(l.ln2),
      ...affine(l.fc),
      ...affine(l.mlpProj),
    ]),
  ];
}

/** Derselbe Gewichtssatz mit jedem Tensor durch `move` ersetzt. */
function mapWeights(weights: Gpt2Weights, move: (t: Float32Array) => Float32Array): Gpt2Weights {
  const norm = (n: Norm): Norm => ({ g: move(n.g), b: move(n.b) });
  const affine = (a: Affine): Affine => ({ w: move(a.w), b: move(a.b) });
  return {
    wte: move(weights.wte),
    wpe: move(weights.wpe),
    layers: weights.layers.map((l) => ({
      ln1: norm(l.ln1),
      attn: affine(l.attn),
      attnProj: affine(l.attnProj),
      ln2: norm(l.ln2),
      fc: affine(l.fc),
      mlpProj: affine(l.mlpProj),
    })),
    lnF: norm(weights.lnF),
  };
}

/** Kapazität in Werten (SPEC-0008 §3.3), für beide Kerne gleich. */
interface Capacity {
  inputs: number;
  outputs: number;
}

function capacityOf(config: Gpt2Config): Capacity {
  const { contextLength: c, dModel: d, dMlp: m, vocabSize } = config;
  return { inputs: c * Math.max(d, m), outputs: Math.max(c * Math.max(3 * d, m), vocabSize) };
}

function checkSize(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} muss eine nicht negative ganze Zahl sein (${value}).`);
  }
}

function checkLength(array: Float32Array, needed: number, label: string): void {
  if (array.length < needed) {
    throw new RangeError(`${label} hat ${array.length} Werte, gebraucht werden ${needed}.`);
  }
}

/** Gemeinsame Vorbedingungen beider Kerne (CON-0019 K-02). */
class Preconditions {
  constructor(
    private readonly buffers: ReadonlySet<ArrayBufferLike>,
    private readonly capacity: Capacity,
  ) {}

  affine(
    x: Float32Array,
    rows: number,
    inputs: number,
    w: Float32Array,
    b: Float32Array,
    outputs: number,
  ): void {
    checkSize(rows, 'rows');
    checkSize(inputs, 'inputs');
    checkSize(outputs, 'outputs');
    checkLength(x, rows * inputs, 'x');
    checkLength(w, inputs * outputs, 'w');
    checkLength(b, outputs, 'b');
    this.own(w);
    this.own(b);
    this.fits(rows * inputs, rows * outputs);
  }

  unembed(h: Float32Array, e: Float32Array, n: number, k: number): void {
    checkSize(n, 'n');
    checkSize(k, 'k');
    checkLength(h, k, 'h');
    checkLength(e, n * k, 'e');
    this.own(e);
    this.fits(k, n);
  }

  private own(tensor: Float32Array): void {
    if (!this.buffers.has(tensor.buffer)) throw new Error(FOREIGN);
  }

  private fits(inputs: number, outputs: number): void {
    if (inputs > this.capacity.inputs || outputs > this.capacity.outputs) {
      throw new RangeError(
        `Die Rechnung braucht ${inputs} Eingabe- und ${outputs} Ausgabewerte; der Rechenkern fasst ${this.capacity.inputs} und ${this.capacity.outputs}.`,
      );
    }
  }
}

export function createJsKernel(config: Gpt2Config, weights: Gpt2Weights): KernelSetup {
  const check = new Preconditions(
    new Set(tensorsOf(weights).map((t) => t.buffer)),
    capacityOf(config),
  );
  const kernel: MatrixKernel = {
    name: 'js',
    affine(x, rows, inputs, w, b, outputs) {
      check.affine(x, rows, inputs, w, b, outputs);
      return jsAffine(x, rows, inputs, w, b, outputs);
    },
    unembed(h, e, n, k) {
      check.unembed(h, e, n, k);
      const out = new Float32Array(n);
      for (let t = 0; t < n; t += 1) {
        let dot = 0;
        const base = t * k;
        for (let c = 0; c < k; c += 1) dot += (h[c] ?? 0) * (e[base + c] ?? 0);
        out[t] = dot;
      }
      return out;
    },
  };
  return { kernel, weights };
}

interface KernelExports {
  unembed(h: number, e: number, out: number, n: number, k: number): void;
  affine(
    x: number,
    rows: number,
    inputs: number,
    w: number,
    b: number,
    outputs: number,
    out: number,
  ): void;
}

let moduleBytes: Uint8Array | null = null;

function kernelBytes(): Uint8Array {
  moduleBytes ??= Uint8Array.from(atob(KERNEL_WASM_BASE64), (c) => c.charCodeAt(0));
  return moduleBytes;
}

const aligned = (bytes: number): number => Math.ceil(bytes / ALIGN) * ALIGN;

/** Kann diese Umgebung das SIMD-Modul übersetzen? */
export function wasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(kernelBytes());
  } catch {
    return false;
  }
}

/**
 * Zieht alle Tensoren in einen festen WebAssembly-Speicher um (16 Byte ausgerichtet), dahinter
 * die Arbeitsbereiche für Ein- und Ausgaben. Wirft, wenn der Speicher nicht angelegt werden kann.
 */
export function createWasmKernel(config: Gpt2Config, weights: Gpt2Weights): KernelSetup {
  const capacity = capacityOf(config);
  const tensorBytes = tensorsOf(weights).reduce((sum, t) => sum + aligned(t.byteLength), 0);
  const inputAt = tensorBytes;
  const outputAt = inputAt + aligned(capacity.inputs * 4);
  const total = outputAt + aligned(capacity.outputs * 4);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(kernelBytes()), {
    env: { memory },
  });
  const exports = instance.exports as unknown as KernelExports;
  const buffer = memory.buffer;

  let next = 0;
  const moved = mapWeights(weights, (tensor) => {
    const view = new Float32Array(buffer, next, tensor.length);
    view.set(tensor);
    next += aligned(tensor.byteLength);
    return view;
  });
  const check = new Preconditions(new Set([buffer]), capacity);
  const input = new Float32Array(buffer, inputAt, capacity.inputs);

  const kernel: MatrixKernel = {
    name: 'wasm-simd',
    affine(x, rows, inputs, w, b, outputs) {
      check.affine(x, rows, inputs, w, b, outputs);
      if (rows === 0 || outputs === 0) return new Float32Array(rows * outputs);
      input.set(x.subarray(0, rows * inputs));
      exports.affine(inputAt, rows, inputs, w.byteOffset, b.byteOffset, outputs, outputAt);
      return new Float32Array(buffer, outputAt, rows * outputs).slice();
    },
    unembed(h, e, n, k) {
      check.unembed(h, e, n, k);
      if (n === 0) return new Float32Array(0);
      input.set(h.subarray(0, k));
      exports.unembed(inputAt, e.byteOffset, outputAt, n, k);
      return new Float32Array(buffer, outputAt, n).slice();
    },
  };
  return { kernel, weights: moved };
}

/** Wählt den Kern (Factory Method, SPEC-0008 §3.4); `auto` fällt ohne Fehler auf JS zurück. */
export function selectKernel(
  config: Gpt2Config,
  weights: Gpt2Weights,
  prefer: 'auto' | KernelName = 'auto',
  createWasm: (config: Gpt2Config, weights: Gpt2Weights) => KernelSetup = createWasmKernel,
): KernelSetup {
  if (prefer === 'js') return createJsKernel(config, weights);
  if (prefer === 'wasm-simd') return createWasm(config, weights);
  if (wasmSimdSupported()) {
    try {
      return createWasm(config, weights);
    } catch {
      // zu wenig Speicher o. Ä.: der JS-Kern rechnet dieselben Zahlen, nur langsamer
    }
  }
  return createJsKernel(config, weights);
}
