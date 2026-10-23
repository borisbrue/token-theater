import type {
  Architecture,
  Candidate,
  EngineInfo,
  MoeStation,
  Station,
  StationKind,
  Tensor,
  Token,
} from '../../trace/types';
import { checkLensTopN, lensCandidates } from '../lens';
import { createRng } from '../rng';
import type { InferenceEngine, Rng, Tokenizer } from '../types';

/**
 * Deterministische Engine ohne geladene Gewichte (SPEC-0001 §3.9, CON-0002 Tabelle MockEngine):
 * ein echter Mini-Transformer (LayerNorm, kausale Softmax-Attention, MLP mit GELU, Residual,
 * finales LayerNorm, Unembedding) mit Pseudo-Gewichten aus `weightSeed`. Dadurch sind alle
 * Stationen strukturell korrekt. Jeder forward rechnet zustandslos über alle Positionen bis `b`
 * und gibt nur die neuen Zeilen [a, b) aus (KV-Cache-Sicht im Trace). Mit der Option `moe` ersetzt
 * ein Mixture-of-Experts-Block das MLP jedes Layers (SPEC-0011 §3.3, CON-0023 MS-xx).
 */

export const MOCK_VOCAB: readonly string[] = [
  '<unk>',
  '<eos>',
  'die',
  'der',
  'das',
  'ein',
  'eine',
  'katze',
  'hund',
  'maus',
  'vogel',
  'kind',
  'sonne',
  'mond',
  'baum',
  'haus',
  'garten',
  'tisch',
  'sitzt',
  'schläft',
  'läuft',
  'springt',
  'frisst',
  'sieht',
  'hört',
  'mag',
  'sucht',
  'findet',
  'auf',
  'unter',
  'neben',
  'im',
  'am',
  'dem',
  'den',
  'und',
  'aber',
  'dann',
  'nicht',
  'gern',
  'leise',
  'schnell',
  'heute',
  'morgen',
  'klein',
  'groß',
  'rot',
  'grün',
  'alt',
  'jung',
  '.',
  ',',
];

const UNK_ID = 0;
const EOS_ID = 1;
const PUNCTUATION = new Set(['.', ',']);

export const MOCK_ARCHITECTURE: Architecture = {
  nLayers: 2,
  nHeads: 2,
  dModel: 8,
  dMlp: 32,
  vocabSize: MOCK_VOCAB.length,
  contextLength: 64,
};

/** Default-Fähigkeiten: alle Arten des dichten Modells; mit `moe` steht moe an der Stelle von mlp. */
const DENSE_KINDS: readonly StationKind[] = [
  'tokenize',
  'embed',
  'attention',
  'mlp',
  'residual',
  'logits',
  'sample',
];
const MOE_KINDS: readonly StationKind[] = DENSE_KINDS.map((kind) =>
  kind === 'mlp' ? 'moe' : kind,
);
const INTERNAL_KINDS: readonly StationKind[] = ['embed', 'attention', 'mlp', 'moe', 'residual'];

/** Breite eines Experten der Mock-MoE-Engine. */
const MOE_EXPERT_WIDTH = 16;

export interface MoeOptions {
  nExperts: number;
  topK: number;
}

/** Die Mock-MoE-Engine der App: 4 Experten, Top-2 (CON-0023 MS-01). */
export const MOCK_MOE: MoeOptions = { nExperts: 4, topK: 2 };

export interface MockEngineOptions {
  /** Seed der Pseudo-Gewichte („das Modell“). Default 1234. */
  weightSeed?: number;
  /** Gelieferte Stationsarten; Default alle sieben. */
  capabilities?: StationKind[];
  /** In diesem Schrittindex bekommt <eos> die höchste Wahrscheinlichkeit. */
  eosAt?: number;
  /** Kandidaten der Logit-Lens nach jedem MLP, 0 bis MAX_LENS_TOP_N; Default 5, 0 = aus. */
  lensTopN?: number;
  /** Mixture of Experts statt MLP in jedem Layer (SPEC-0011 §3.3). */
  moe?: MoeOptions;
}

function checkMoe(moe: MoeOptions | undefined, capabilities: readonly StationKind[]): void {
  if (moe === undefined) {
    if (capabilities.includes('moe')) throw new RangeError('Fähigkeit moe ohne Option moe');
    return;
  }
  const { nExperts, topK } = moe;
  if (!Number.isInteger(nExperts) || nExperts < 2) {
    throw new RangeError(`nExperts muss eine ganze Zahl ≥ 2 sein, nicht ${nExperts}`);
  }
  if (!Number.isInteger(topK) || topK < 1 || topK > nExperts) {
    throw new RangeError(`topK muss eine ganze Zahl in 1 … ${nExperts} sein, nicht ${topK}`);
  }
  if (capabilities.includes('mlp')) throw new RangeError('Option moe verträgt keine Fähigkeit mlp');
}

const DEFAULT_LENS_TOP_N = 5;

class MockTokenizer implements Tokenizer {
  readonly eosTokenId = EOS_ID;
  private readonly ids = new Map(MOCK_VOCAB.map((text, id) => [text, id]));

  tokenize(text: string): Promise<Token[]> {
    const words = text.toLowerCase().match(/[.,]|[^\s.,]+/g) ?? [];
    return Promise.resolve(
      words.map((word) => {
        const id = this.ids.get(word);
        return id === undefined || id === EOS_ID
          ? { id: UNK_ID, text: MOCK_VOCAB[UNK_ID] ?? '<unk>' }
          : { id, text: word };
      }),
    );
  }

  decode(tokens: Token[]): string {
    let text = '';
    for (const token of tokens) {
      if (token.id === EOS_ID) continue;
      text += text === '' || PUNCTUATION.has(token.text) ? token.text : ` ${token.text}`;
    }
    return text;
  }
}

// ── Kleine lineare Algebra auf Float32Array (Zeilen = Positionen) ──

type Matrix = { rows: number; cols: number; data: Float32Array };

function randomMatrix(rng: Rng, rows: number, cols: number, scale: number): Matrix {
  const data = new Float32Array(rows * cols);
  for (let i = 0; i < data.length; i += 1) data[i] = (rng.next() * 2 - 1) * scale;
  return { rows, cols, data };
}

function randomVector(rng: Rng, size: number, center: number, scale: number): Float32Array {
  const data = new Float32Array(size);
  for (let i = 0; i < size; i += 1) data[i] = center + (rng.next() * 2 - 1) * scale;
  return data;
}

function rowOf(m: Matrix, row: number): Float32Array {
  return m.data.subarray(row * m.cols, (row + 1) * m.cols);
}

/** x · W (+ bias): x hat W.rows Einträge, Ergebnis W.cols. */
function project(x: Float32Array, w: Matrix, bias?: Float32Array): Float32Array {
  const out = new Float32Array(w.cols);
  for (let j = 0; j < w.cols; j += 1) {
    let sum = bias?.[j] ?? 0;
    for (let i = 0; i < w.rows; i += 1) sum += (x[i] ?? 0) * (w.data[i * w.cols + j] ?? 0);
    out[j] = sum;
  }
  return out;
}

function layerNorm(x: Float32Array, gamma: Float32Array, beta: Float32Array): Float32Array {
  let mean = 0;
  for (const value of x) mean += value;
  mean /= x.length;
  let variance = 0;
  for (const value of x) variance += (value - mean) ** 2;
  variance /= x.length;
  const inv = 1 / Math.sqrt(variance + 1e-5);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 1) {
    out[i] = ((x[i] ?? 0) - mean) * inv * (gamma[i] ?? 1) + (beta[i] ?? 0);
  }
  return out;
}

function gelu(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
}

/** Elementweise Summe in float32 (wie der Residual Stream sie speichert). */
function addRows(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

function tensor(shape: number[], rows: readonly Float32Array[]): Tensor {
  const width = rows[0]?.length ?? 0;
  const data = new Float32Array(rows.length * width);
  rows.forEach((row, i) => data.set(row, i * width));
  return { shape, dtype: 'float32', data };
}

interface LayerWeights {
  ln1Gamma: Float32Array;
  ln1Beta: Float32Array;
  wq: Matrix;
  wk: Matrix;
  wv: Matrix;
  wo: Matrix;
  ln2Gamma: Float32Array;
  ln2Beta: Float32Array;
  w1: Matrix;
  b1: Float32Array;
  w2: Matrix;
  b2: Float32Array;
}

interface Weights {
  tokenEmbedding: Matrix;
  positionEmbedding: Matrix;
  layers: LayerWeights[];
  lnFGamma: Float32Array;
  lnFBeta: Float32Array;
  unembedding: Matrix;
}

interface Expert {
  w1: Matrix;
  b1: Float32Array;
  w2: Matrix;
  b2: Float32Array;
}

interface MoeLayerWeights {
  router: Matrix;
  experts: Expert[];
}

/**
 * Router und Experten aus einem eigenen Generator: Die dichten Gewichte bleiben dieselben, ein
 * Trace ohne `moe` bleibt bytegleich (CON-0023 MS-05).
 */
function createMoeWeights(seed: number, a: Architecture, moe: MoeOptions): MoeLayerWeights[] {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const d = a.dModel;
  return Array.from({ length: a.nLayers }, () => ({
    router: randomMatrix(rng, d, moe.nExperts, 1),
    experts: Array.from({ length: moe.nExperts }, () => ({
      w1: randomMatrix(rng, d, MOE_EXPERT_WIDTH, 0.6),
      b1: randomVector(rng, MOE_EXPERT_WIDTH, 0, 0.1),
      w2: randomMatrix(rng, MOE_EXPERT_WIDTH, d, 0.3),
      b2: randomVector(rng, d, 0, 0.1),
    })),
  }));
}

interface Route {
  experts: number[];
  gates: number[];
}

/** Top-k der Router-Logits (Gleichstand: kleinere ID zuerst), Gates = Softmax der gewählten. */
function routeMoe(logits: Float32Array, topK: number): Route {
  const experts = Array.from(logits, (value, e) => ({ value, e }))
    .sort((x, y) => y.value - x.value || x.e - y.e)
    .slice(0, topK)
    .map((entry) => entry.e);
  const max = logits[experts[0] ?? 0] ?? 0;
  const exps = experts.map((e) => Math.exp((logits[e] ?? 0) - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return { experts, gates: exps.map((value) => value / total) };
}

function mixExperts(x: Float32Array, route: Route, experts: readonly Expert[]): Float32Array {
  const mixed = new Float64Array(x.length);
  route.experts.forEach((e, j) => {
    const expert = experts[e];
    if (expert === undefined) return;
    const out = project(project(x, expert.w1, expert.b1).map(gelu), expert.w2, expert.b2);
    const gate = route.gates[j] ?? 0;
    for (let i = 0; i < mixed.length; i += 1) mixed[i] = (mixed[i] ?? 0) + gate * (out[i] ?? 0);
  });
  return Float32Array.from(mixed);
}

function createWeights(seed: number, a: Architecture): Weights {
  const rng = createRng(seed);
  const d = a.dModel;
  return {
    tokenEmbedding: randomMatrix(rng, a.vocabSize, d, 1),
    positionEmbedding: randomMatrix(rng, a.contextLength, d, 0.3),
    layers: Array.from({ length: a.nLayers }, () => ({
      ln1Gamma: randomVector(rng, d, 1, 0.1),
      ln1Beta: randomVector(rng, d, 0, 0.1),
      wq: randomMatrix(rng, d, d, 0.8),
      wk: randomMatrix(rng, d, d, 0.8),
      wv: randomMatrix(rng, d, d, 0.6),
      wo: randomMatrix(rng, d, d, 0.5),
      ln2Gamma: randomVector(rng, d, 1, 0.1),
      ln2Beta: randomVector(rng, d, 0, 0.1),
      w1: randomMatrix(rng, d, a.dMlp, 0.6),
      b1: randomVector(rng, a.dMlp, 0, 0.1),
      w2: randomMatrix(rng, a.dMlp, d, 0.3),
      b2: randomVector(rng, d, 0, 0.1),
    })),
    lnFGamma: randomVector(rng, d, 1, 0.1),
    lnFBeta: randomVector(rng, d, 0, 0.1),
    unembedding: randomMatrix(rng, d, a.vocabSize, 1.5),
  };
}

/** Kausale Attention aller Positionen; liefert Ausgaben und Gewichte je Position. */
function attend(
  q: Float32Array[],
  k: Float32Array[],
  v: Float32Array[],
  heads: number,
): { mixed: Float32Array[]; weights: Float32Array[][] } {
  const d = q[0]?.length ?? 0;
  const dh = d / heads;
  const scale = 1 / Math.sqrt(dh);
  const mixed = q.map(() => new Float32Array(d));
  const weights: Float32Array[][] = Array.from({ length: heads }, () => []);
  q.forEach((qi, i) => {
    for (let h = 0; h < heads; h += 1) {
      const scores = new Float64Array(i + 1);
      let max = -Infinity;
      for (let j = 0; j <= i; j += 1) {
        let dot = 0;
        for (let c = h * dh; c < (h + 1) * dh; c += 1) dot += (qi[c] ?? 0) * (k[j]?.[c] ?? 0);
        scores[j] = dot * scale;
        max = Math.max(max, scores[j] ?? 0);
      }
      let total = 0;
      for (let j = 0; j <= i; j += 1) {
        scores[j] = Math.exp((scores[j] ?? 0) - max);
        total += scores[j] ?? 0;
      }
      const row = new Float32Array(q.length); // rechts der Diagonale exakt 0
      for (let j = 0; j <= i; j += 1) row[j] = (scores[j] ?? 0) / total;
      weights[h]?.push(row);
      const out = mixed[i];
      if (out === undefined) continue;
      for (let c = h * dh; c < (h + 1) * dh; c += 1) {
        let sum = 0;
        for (let j = 0; j <= i; j += 1) sum += (row[j] ?? 0) * (v[j]?.[c] ?? 0);
        out[c] = sum;
      }
    }
  });
  return { mixed, weights };
}

function softmaxDistribution(logits: Float64Array): Candidate[] {
  let max = -Infinity;
  for (const value of logits) max = Math.max(max, value);
  const exps = Array.from(logits, (value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  const candidates = exps.map((value, id) => ({
    token: { id, text: MOCK_VOCAB[id] ?? '<unk>' },
    logit: logits[id] ?? 0,
    prob: value / total,
  }));
  return candidates.sort((x, y) => y.prob - x.prob || x.token.id - y.token.id);
}

export class MockEngine implements InferenceEngine {
  readonly info: EngineInfo;
  readonly tokenizer: Tokenizer = new MockTokenizer();
  private readonly weights: Weights;
  private readonly moe: { options: MoeOptions; layers: MoeLayerWeights[] } | null;
  private readonly capabilities: ReadonlySet<StationKind>;
  private readonly eosAt: number | undefined;
  private readonly lensTopN: number;
  /** Schrittindex des aktuellen Laufs; beginnt bei jedem forward mit a = 0 neu. */
  private step = 0;

  constructor(options: MockEngineOptions = {}) {
    const capabilities = options.capabilities ?? [
      ...(options.moe === undefined ? DENSE_KINDS : MOE_KINDS),
    ];
    checkMoe(options.moe, capabilities);
    const internals = capabilities.some((kind) => INTERNAL_KINDS.includes(kind));
    const seed = options.weightSeed ?? 1234;
    this.capabilities = new Set(capabilities);
    this.eosAt = options.eosAt;
    this.lensTopN = checkLensTopN(options.lensTopN ?? DEFAULT_LENS_TOP_N);
    this.weights = createWeights(seed, MOCK_ARCHITECTURE);
    this.moe =
      options.moe === undefined
        ? null
        : {
            options: { ...options.moe },
            layers: createMoeWeights(seed, MOCK_ARCHITECTURE, options.moe),
          };
    const architecture: Architecture =
      options.moe === undefined
        ? { ...MOCK_ARCHITECTURE }
        : {
            ...MOCK_ARCHITECTURE,
            dMlp: MOE_EXPERT_WIDTH,
            nExperts: options.moe.nExperts,
            topK: options.moe.topK,
          };
    this.info = {
      kind: 'mock',
      model: options.moe === undefined ? 'mock-de-52' : 'mock-de-52-moe',
      capabilities: [...capabilities],
      architecture: internals ? architecture : null,
      eosTokenId: EOS_ID,
    };
  }

  load(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {}

  async *forward(context: Token[], newPositions: [number, number]): AsyncIterable<Station> {
    const [a, b] = newPositions;
    this.step = a === 0 ? 0 : this.step + 1;
    const arch = MOCK_ARCHITECTURE;
    const w = this.weights;
    const positions = context.slice(0, b);
    const rows = <T>(all: readonly T[]): T[] => all.slice(a, b);
    const n = b - a;

    const tokenRows = positions.map((t) => rowOf(w.tokenEmbedding, t.id));
    const positionRows = positions.map((_, p) => rowOf(w.positionEmbedding, p));
    let stream = tokenRows.map((row, p) => addRows(row, positionRows[p] ?? row));
    if (this.capabilities.has('embed')) {
      yield {
        kind: 'embed',
        token: tensor([n, arch.dModel], rows(tokenRows)),
        position: tensor([n, arch.dModel], rows(positionRows)),
        sum: tensor([n, arch.dModel], rows(stream)),
      };
    }

    for (let layer = 0; layer < arch.nLayers; layer += 1) {
      const lw = w.layers[layer];
      if (lw === undefined) break;
      const lnIn = stream.map((x) => layerNorm(x, lw.ln1Gamma, lw.ln1Beta));
      const q = lnIn.map((x) => project(x, lw.wq));
      const k = lnIn.map((x) => project(x, lw.wk));
      const v = lnIn.map((x) => project(x, lw.wv));
      const { mixed, weights } = attend(q, k, v, arch.nHeads);
      const out = mixed.map((x) => project(x, lw.wo));
      if (this.capabilities.has('attention')) {
        const weightRows = weights.flatMap((perHead) => rows(perHead));
        yield {
          kind: 'attention',
          layer,
          lnIn: tensor([n, arch.dModel], rows(lnIn)),
          q: tensor([n, arch.dModel], rows(q)),
          k: tensor([n, arch.dModel], rows(k)),
          v: tensor([n, arch.dModel], rows(v)),
          weights: tensor([arch.nHeads, n, b], weightRows),
          out: tensor([n, arch.dModel], rows(out)),
        };
      }
      stream = stream.map((x, p) => addRows(x, out[p] ?? x));
      if (this.capabilities.has('residual')) {
        yield {
          kind: 'residual',
          layer,
          after: 'attention',
          stream: tensor([n, arch.dModel], rows(stream)),
        };
      }

      const lnIn2 = stream.map((x) => layerNorm(x, lw.ln2Gamma, lw.ln2Beta));
      const moeLayer = this.moe?.layers[layer];
      if (this.moe !== null && moeLayer !== undefined) {
        const { nExperts, topK } = this.moe.options;
        const routerLogits = lnIn2.map((x) => project(x, moeLayer.router));
        const routes = routerLogits.map((logits) => routeMoe(logits, topK));
        const out2 = lnIn2.map((x, p) =>
          mixExperts(x, routes[p] ?? { experts: [], gates: [] }, moeLayer.experts),
        );
        if (this.capabilities.has('moe')) {
          const station: MoeStation = {
            kind: 'moe',
            layer,
            lnIn: tensor([n, arch.dModel], rows(lnIn2)),
            routerLogits: tensor([n, nExperts], rows(routerLogits)),
            experts: rows(routes).map((route) => route.experts),
            gates: rows(routes).map((route) => route.gates),
            out: tensor([n, arch.dModel], rows(out2)),
          };
          yield station;
        }
        stream = stream.map((x, p) => addRows(x, out2[p] ?? x));
        if (this.capabilities.has('residual')) {
          const residual: Station = {
            kind: 'residual',
            layer,
            after: 'moe',
            stream: tensor([n, arch.dModel], rows(stream)),
          };
          if (this.lensTopN > 0) residual.lens = this.lens(stream[stream.length - 1]);
          yield residual;
        }
        continue;
      }

      const hidden = lnIn2.map((x) => project(x, lw.w1, lw.b1).map(gelu));
      const out2 = hidden.map((x) => project(x, lw.w2, lw.b2));
      if (this.capabilities.has('mlp')) {
        yield {
          kind: 'mlp',
          layer,
          lnIn: tensor([n, arch.dModel], rows(lnIn2)),
          hidden: tensor([n, arch.dMlp], rows(hidden)),
          out: tensor([n, arch.dModel], rows(out2)),
        };
      }
      stream = stream.map((x, p) => addRows(x, out2[p] ?? x));
      if (this.capabilities.has('residual')) {
        const residual: Station = {
          kind: 'residual',
          layer,
          after: 'mlp',
          stream: tensor([n, arch.dModel], rows(stream)),
        };
        if (this.lensTopN > 0) residual.lens = this.lens(stream[stream.length - 1]);
        yield residual;
      }
    }

    yield {
      kind: 'logits',
      vocabSize: arch.vocabSize,
      distribution: softmaxDistribution(this.logitsOf(stream[stream.length - 1])),
      coverage: 1,
    };
  }

  /** Logits eines Stroms: finales LayerNorm, Unembedding und die EOS-Regel (CON-0002). */
  private logitsOf(row: Float32Array | undefined): Float64Array {
    const w = this.weights;
    const final = layerNorm(
      row ?? new Float32Array(MOCK_ARCHITECTURE.dModel),
      w.lnFGamma,
      w.lnFBeta,
    );
    const logits = Float64Array.from(project(final, w.unembedding));
    let maxOther = -Infinity;
    logits.forEach((value, id) => {
      if (id !== EOS_ID) maxOther = Math.max(maxOther, value);
    });
    // <eos> nur bei eosAt vorn, sonst nie das wahrscheinlichste Token.
    logits[EOS_ID] = this.step === this.eosAt ? maxOther + 3 : maxOther - 1;
    return logits;
  }

  /** Logit-Lens mit derselben Logit-Funktion wie die logits-Station (CON-0016 L-06). */
  private lens(row: Float32Array | undefined): Candidate[] {
    const logits = this.logitsOf(row);
    return lensCandidates(logits, logits.length, this.lensTopN).map((entry) => ({
      token: { id: entry.id, text: MOCK_VOCAB[entry.id] ?? '<unk>' },
      logit: entry.logit,
      prob: entry.prob,
    }));
  }
}
