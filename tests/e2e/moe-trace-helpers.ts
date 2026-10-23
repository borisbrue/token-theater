/**
 * Synthetische MoE-Traces in serialisierter Form (CON-0001 v0.5.0) für TST-0024 und TST-0026
 * (SPEC-0011 §3.11). Ein Schritt, zwei Prompt-Tokens, ein Kopf, D = 4; jede Zahl ist so gewählt,
 * dass der Trace alle Invarianten erfüllt. Ohne Playwright-Abhängigkeit, damit Vitest es nutzt.
 */

export type Json = Record<string, unknown>;

export interface MoeTraceOptions {
  layers: number;
  experts: number;
  topK: number;
  /** Layer, die statt moe ein dichtes mlp haben (gemischter Trace). */
  dense?: readonly number[];
}

const D = 4;
const N = 2;
const TOKENS = [
  { id: 2, text: 'die' },
  { id: 7, text: 'katze' },
];
const CHOSEN = { id: 3, text: ' sitzt' };
const DISTRIBUTION = [
  { token: CHOSEN, logit: 1, prob: 0.6 },
  { token: { id: 4, text: ' schläft' }, logit: 0.6, prob: 0.4 },
];

/** float32 little-endian als Base64. */
export function encodeTensor(shape: number[], values: readonly number[]): Json {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  return { shape, dtype: 'float32', data: bytes.toString('base64') };
}

export function decodeTensor(tensor: unknown): number[] {
  const data = (tensor as { data: string }).data;
  const bytes = Buffer.from(data, 'base64');
  return Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
}

const filled = (shape: number[], seed: number): Json => {
  const size = shape.reduce((a, b) => a * b, 1);
  return encodeTensor(
    shape,
    Array.from({ length: size }, (_, i) => Math.round(Math.sin(seed * 31 + i) * 100) / 100),
  );
};

/** Router-Logits je Zeile paarweise verschieden; liefert Logits, Top-k und Gates. */
export function routing(
  layer: number,
  experts: number,
  topK: number,
): { logits: number[][]; chosen: number[][]; gates: number[][] } {
  const logits = Array.from({ length: N }, (_, i) =>
    Array.from({ length: experts }, (_, e) => ((e * 7 + i * 3 + layer * 5) % experts) / 4),
  );
  const chosen = logits.map((row) =>
    row
      .map((value, e) => ({ value, e }))
      .sort((a, b) => b.value - a.value || a.e - b.e)
      .slice(0, topK)
      .map((entry) => entry.e),
  );
  const gates = chosen.map((ids, i) => {
    const values = ids.map((e) => Math.exp(logits[i]?.[e] ?? 0));
    const total = values.reduce((a, b) => a + b, 0);
    return values.map((v) => v / total);
  });
  return { logits, chosen, gates };
}

/** Ein gültiger MoE-Trace mit `layers` Layern (Stationsfolge nach CON-0001 INV-05). */
export function buildMoeTrace(options: MoeTraceOptions): Json {
  const { layers, experts, topK } = options;
  const dense = new Set(options.dense ?? []);
  const capabilities = ['tokenize', 'attention', 'moe', 'residual', 'logits', 'sample'];
  if (dense.size > 0) capabilities.splice(2, 0, 'mlp');
  const stations: Json[] = [{ kind: 'tokenize', tokens: TOKENS }];
  for (let layer = 0; layer < layers; layer += 1) {
    stations.push({
      kind: 'attention',
      layer,
      lnIn: filled([N, D], layer + 1),
      q: filled([N, D], layer + 2),
      k: filled([N, D], layer + 3),
      v: filled([N, D], layer + 4),
      weights: encodeTensor([1, N, N], [1, 0, 0.5, 0.5]),
      out: filled([N, D], layer + 5),
    });
    stations.push({
      kind: 'residual',
      layer,
      after: 'attention',
      stream: filled([N, D], layer + 6),
    });
    if (dense.has(layer)) {
      stations.push({
        kind: 'mlp',
        layer,
        lnIn: filled([N, D], layer + 7),
        hidden: filled([N, D], layer + 8),
        out: filled([N, D], layer + 9),
      });
    } else {
      const { logits, chosen, gates } = routing(layer, experts, topK);
      stations.push({
        kind: 'moe',
        layer,
        lnIn: filled([N, D], layer + 7),
        routerLogits: encodeTensor([N, experts], logits.flat()),
        experts: chosen,
        gates,
        out: filled([N, D], layer + 9),
      });
    }
    stations.push({
      kind: 'residual',
      layer,
      after: dense.has(layer) ? 'mlp' : 'moe',
      stream: filled([N, D], layer + 10),
    });
  }
  stations.push({ kind: 'logits', vocabSize: 16, distribution: DISTRIBUTION, coverage: 1 });
  stations.push({ kind: 'sample', distribution: DISTRIBUTION, random: null, chosen: CHOSEN });
  return {
    schemaVersion: 1,
    id: 'moe-synthetic',
    createdAt: '2026-10-23T12:00:00Z',
    engine: {
      kind: 'test',
      model: 'moe-synthetic',
      capabilities,
      architecture: {
        nLayers: layers,
        nHeads: 1,
        dModel: D,
        dMlp: D,
        vocabSize: 16,
        contextLength: 64,
        nExperts: experts,
        topK,
      },
      eosTokenId: null,
    },
    prompt: 'die katze',
    maxTokens: 1,
    sampling: { strategy: 'greedy', seed: 0, params: {} },
    steps: [
      {
        index: 0,
        contextTokens: TOKENS,
        newPositions: [0, N],
        stations,
        chosen: CHOSEN,
        text: 'die katze sitzt',
      },
    ],
    finishReason: 'max-tokens',
  };
}

/** Index der moe-Station von `layer` in Schritt 0 eines Traces aus `buildMoeTrace`. */
export function moeIndex(layer: number): number {
  return 1 + layer * 4 + 2;
}
