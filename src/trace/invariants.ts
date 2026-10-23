import { base64ToBytes, base64ToFloat32 } from './base64';
import { FEED_FORWARD_KINDS, type ImportIssue } from './types';

/**
 * Semantische Invarianten INV-01 bis INV-13 und INV-15 bis INV-18 aus CON-0001 auf dem serialisierten
 * Trace (Tensordaten als Base64). Erwartet ein schema-gültiges Objekt; fehlende Teile werden
 * übersprungen statt zu werfen.
 */

interface SToken {
  id: number;
  text: string;
}

interface SCandidate {
  token: SToken;
  prob: number;
}

interface STensor {
  shape: number[];
  dtype: string;
  data: string;
}

type SStation = Record<string, unknown> & { kind: string; layer?: number; after?: string };

interface SStep {
  index: number;
  contextTokens: SToken[];
  newPositions: number[];
  stations: SStation[];
  chosen: SToken;
  text: string;
}

interface SArchitecture {
  nLayers: number;
  nHeads: number;
  dModel: number;
  dMlp: number;
  vocabSize: number;
  contextLength: number;
  nExperts?: number;
  topK?: number;
}

interface SBpeWord {
  text: string;
  bytes: number[];
  stages: number[][][];
  ranks: number[];
  ids: number[];
}

interface STrace {
  prompt: string;
  engine: {
    capabilities: string[];
    architecture: SArchitecture | null;
    eosTokenId: number | null;
  };
  maxTokens: number;
  steps: SStep[];
  finishReason: string;
  error?: unknown;
}

const INTERNAL_KINDS = ['embed', 'attention', 'mlp', 'moe', 'residual'];
const FEED_FORWARD: readonly string[] = FEED_FORWARD_KINDS;
const GATE_SUM_TOLERANCE = 1e-5;
const ROW_SUM_TOLERANCE = 1e-5;
const PROB_SUM_TOLERANCE = 1e-6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTensor(value: unknown): value is STensor {
  return (
    isRecord(value) &&
    Array.isArray(value['shape']) &&
    typeof value['dtype'] === 'string' &&
    typeof value['data'] === 'string'
  );
}

function sameToken(a: SToken | undefined, b: SToken | undefined): boolean {
  return a !== undefined && b !== undefined && a.id === b.id && a.text === b.text;
}

function sameTokens(a: SToken[], b: SToken[]): boolean {
  return a.length === b.length && a.every((token, i) => sameToken(token, b[i]));
}

function product(shape: number[]): number {
  return shape.reduce((total, dim) => total * dim, 1);
}

function sameShape(actual: number[], expected: number[]): boolean {
  return actual.length === expected.length && actual.every((dim, i) => dim === expected[i]);
}

function describeShape(shape: number[]): string {
  return `[${shape.join(', ')}]`;
}

class Collector {
  readonly issues: ImportIssue[] = [];

  add(invariant: string, path: string, message: string): void {
    this.issues.push({ path, message, invariant });
  }
}

/**
 * Feed-Forward-Art je Layer (INV-05 seit v0.5.0). Die Engine legt sie fest (CON-0001 INV-06); der
 * Trace verrät sie durch die mlp/moe-Station des Layers oder, fehlt diese Fähigkeit, durch `after`
 * der folgenden residual-Station. Ohne beides gilt die einzige gelieferte Art, sonst `mlp`.
 */
function feedForwardOf(stations: SStation[], capabilities: Set<string>, layer: number): string {
  const station = stations.find((s) => FEED_FORWARD.includes(s.kind) && s.layer === layer);
  if (station !== undefined && capabilities.has(station.kind)) return station.kind;
  const residual = stations.find(
    (s) =>
      s.kind === 'residual' &&
      s.layer === layer &&
      typeof s.after === 'string' &&
      FEED_FORWARD.includes(s.after),
  );
  if (station === undefined && residual?.after !== undefined) return residual.after;
  return capabilities.has('mlp') || !capabilities.has('moe') ? 'mlp' : 'moe';
}

/** Erwartete Abfolge (kind/layer/after) der Stationen eines Schritts (INV-05). */
function expectedSequence(
  capabilities: Set<string>,
  layers: number,
  first: boolean,
  stations: SStation[],
): string[] {
  const sequence: string[] = [];
  if (first && capabilities.has('tokenize')) {
    sequence.push('tokenize');
  }
  if (capabilities.has('embed')) {
    sequence.push('embed');
  }
  for (let layer = 0; layer < layers; layer += 1) {
    if (capabilities.has('attention')) sequence.push(`attention/${layer}`);
    if (capabilities.has('residual')) sequence.push(`residual/${layer}/attention`);
    const ff = feedForwardOf(stations, capabilities, layer);
    if (capabilities.has(ff)) sequence.push(`${ff}/${layer}`);
    if (capabilities.has('residual')) sequence.push(`residual/${layer}/${ff}`);
  }
  sequence.push('logits', 'sample');
  return sequence;
}

function describeStation(station: SStation): string {
  if (station.kind === 'residual') {
    return `residual/${String(station.layer)}/${String(station.after)}`;
  }
  if (station.kind === 'attention' || FEED_FORWARD.includes(station.kind)) {
    return `${station.kind}/${String(station.layer)}`;
  }
  return station.kind;
}

/** INV-01: Länge und endliche Werte. Liefert die dekodierten Werte, wenn alles stimmt. */
function checkTensorData(tensor: STensor, path: string, out: Collector): Float32Array | undefined {
  let byteLength: number;
  try {
    byteLength = base64ToBytes(tensor.data).byteLength;
  } catch {
    out.add('INV-01', path, 'Tensordaten sind kein gültiges Base64');
    return undefined;
  }
  const expected = 4 * product(tensor.shape);
  if (byteLength !== expected) {
    out.add('INV-01', path, `${byteLength} Bytes statt 4 · ${product(tensor.shape)} = ${expected}`);
    return undefined;
  }
  const values = base64ToFloat32(tensor.data);
  const bad = values.findIndex((value) => !Number.isFinite(value));
  if (bad >= 0) {
    out.add('INV-01', path, `Wert ${bad} ist ${String(values[bad])}`);
    return undefined;
  }
  return values;
}

function tensorShapes(
  station: SStation,
  n: number,
  b: number,
  arch: SArchitecture,
): Record<string, number[]> {
  const row = [n, arch.dModel];
  switch (station.kind) {
    case 'embed':
      return { token: row, position: row, sum: row };
    case 'attention':
      return { lnIn: row, q: row, k: row, v: row, weights: [arch.nHeads, n, b], out: row };
    case 'mlp':
      return { lnIn: row, hidden: [n, arch.dMlp], out: row };
    case 'moe':
      return arch.nExperts === undefined
        ? { lnIn: row, out: row }
        : { lnIn: row, routerLogits: [n, arch.nExperts], out: row };
    case 'residual':
      return { stream: row };
    default:
      return {};
  }
}

/** INV-09: Werte in [0, 1], Zeilensumme 1, nichts rechts der Diagonale. */
function checkCausal(
  values: Float32Array,
  shape: number[],
  a: number,
  path: string,
  out: Collector,
) {
  const [heads = 0, rows = 0, cols = 0] = shape;
  for (let h = 0; h < heads; h += 1) {
    for (let i = 0; i < rows; i += 1) {
      let sum = 0;
      for (let j = 0; j < cols; j += 1) {
        const w = values[(h * rows + i) * cols + j] ?? 0;
        sum += w;
        if (w < 0 || w > 1) {
          out.add('INV-09', path, `Gewicht [${h}, ${i}, ${j}] = ${w} liegt nicht in [0, 1]`);
          return;
        }
        if (j > a + i && w !== 0) {
          out.add('INV-09', path, `Gewicht [${h}, ${i}, ${j}] = ${w} rechts der Diagonale`);
          return;
        }
      }
      if (Math.abs(sum - 1) > ROW_SUM_TOLERANCE) {
        out.add('INV-09', path, `Zeilensumme [${h}, ${i}] ist ${sum}`);
        return;
      }
    }
  }
}

/** INV-10: absteigend sortiert, eindeutige IDs, Summe 1. */
function checkDistribution(distribution: SCandidate[], path: string, out: Collector): void {
  const ids = new Set<number>();
  let sum = 0;
  for (let i = 0; i < distribution.length; i += 1) {
    const current = distribution[i];
    if (current === undefined) continue;
    sum += current.prob;
    if (ids.has(current.token.id)) {
      out.add('INV-10', path, `token.id ${current.token.id} kommt mehrfach vor`);
      return;
    }
    ids.add(current.token.id);
    const previous = distribution[i - 1];
    if (
      previous !== undefined &&
      (previous.prob < current.prob ||
        (previous.prob === current.prob && previous.token.id > current.token.id))
    ) {
      out.add('INV-10', path, `Kandidat ${i} ist nicht absteigend sortiert`);
      return;
    }
  }
  if (Math.abs(sum - 1) > PROB_SUM_TOLERANCE) {
    out.add('INV-10', path, `Wahrscheinlichkeiten summieren sich zu ${sum}`);
  }
}

/** INV-17: Logit-Lens eindeutig, absteigend, prob in [0, 1], Summe ≤ 1, IDs im Vokabular. */
function checkLens(
  lens: SCandidate[],
  path: string,
  arch: SArchitecture | null,
  out: Collector,
): void {
  const seen = new Set<number>();
  let sum = 0;
  lens.forEach((candidate, j) => {
    const { id } = candidate.token;
    if (seen.has(id)) out.add('INV-17', `${path}/${j}/token`, `token.id ${id} kommt mehrfach vor`);
    seen.add(id);
    if (candidate.prob < 0 || candidate.prob > 1) {
      out.add('INV-17', `${path}/${j}/prob`, `prob ${candidate.prob} liegt nicht in [0, 1]`);
    }
    const previous = lens[j - 1];
    if (previous !== undefined && candidate.prob > previous.prob) {
      out.add('INV-17', `${path}/${j}`, `Kandidat ${j} ist nicht absteigend sortiert`);
    }
    if (arch !== null && id >= arch.vocabSize) {
      out.add('INV-17', `${path}/${j}/token`, `token.id ${id} ≥ vocabSize ${arch.vocabSize}`);
    }
    sum += candidate.prob;
  });
  if (sum > 1 + PROB_SUM_TOLERANCE) {
    out.add('INV-17', path, `Wahrscheinlichkeiten summieren sich zu ${sum}`);
  }
}

/** Router-Logits als Zeilen, wenn Form und Daten stimmen (sonst meldet INV-01/INV-08). */
function routerRows(station: SStation, n: number, experts: number): number[][] | undefined {
  const tensor = station['routerLogits'];
  if (!isTensor(tensor) || !sameShape(tensor.shape, [n, experts])) return undefined;
  let values: Float32Array;
  try {
    values = base64ToFloat32(tensor.data);
  } catch {
    return undefined;
  }
  if (values.length !== n * experts) return undefined;
  return Array.from({ length: n }, (_, i) =>
    Array.from(values.subarray(i * experts, (i + 1) * experts)),
  );
}

/** INV-18: Zeilen, Top-k-Wahl und Gates einer moe-Station. */
function checkRouting(
  station: SStation,
  n: number,
  arch: SArchitecture,
  path: string,
  out: Collector,
): void {
  const { nExperts, topK } = arch;
  const experts = station['experts'];
  const gates = station['gates'];
  if (nExperts === undefined || topK === undefined) return;
  if (!Array.isArray(experts) || !Array.isArray(gates)) return;
  if (experts.length !== n || gates.length !== n) {
    out.add(
      'INV-18',
      `${path}/experts`,
      `experts/gates haben ${experts.length}/${gates.length} Zeilen statt ${n}`,
    );
  }
  const logits = routerRows(station, n, nExperts);
  experts.forEach((row: unknown, i) => {
    if (!Array.isArray(row)) return;
    const ids = row as number[];
    const rowPath = `${path}/experts/${i}`;
    if (ids.length !== topK) {
      out.add('INV-18', rowPath, `${ids.length} Experten statt topK ${topK}`);
    }
    if (new Set(ids).size !== ids.length) {
      out.add('INV-18', rowPath, 'Experten-IDs kommen mehrfach vor');
    }
    const outside = ids.find((id) => !Number.isInteger(id) || id < 0 || id >= nExperts);
    if (outside !== undefined) {
      out.add('INV-18', rowPath, `Experte ${outside} liegt nicht in 0 … ${nExperts - 1}`);
    }
    const values = logits?.[i];
    if (values !== undefined && outside === undefined) {
      const chosen = new Set(ids);
      const weakestChosen = Math.min(...ids.map((id) => values[id] ?? -Infinity));
      const strongestOther = Math.max(-Infinity, ...values.filter((_, e) => !chosen.has(e)));
      if (weakestChosen < strongestOther) {
        out.add('INV-18', rowPath, 'Ein nicht gewählter Experte hat eine höhere Router-Bewertung');
      }
    }
  });
  gates.forEach((row: unknown, i) => {
    if (!Array.isArray(row)) return;
    const values = row as number[];
    const rowPath = `${path}/gates/${i}`;
    const expertRow: unknown = experts[i];
    if (Array.isArray(expertRow) && expertRow.length !== values.length) {
      out.add('INV-18', rowPath, `${values.length} Gates für ${expertRow.length} Experten`);
    }
    if (values.some((g, j) => j > 0 && g > (values[j - 1] ?? 0))) {
      out.add('INV-18', rowPath, 'Gates sind nicht absteigend');
    }
    const sum = values.reduce((total, g) => total + g, 0);
    if (sum > 1 + GATE_SUM_TOLERANCE) {
      out.add('INV-18', rowPath, `Gates summieren sich zu ${sum}`);
    }
  });
}

function checkStepStations(trace: STrace, step: SStep, stepPath: string, out: Collector): void {
  const { architecture: arch } = trace.engine;
  const capabilities = new Set(trace.engine.capabilities);
  const [a = 0, b = 0] = step.newPositions;
  const n = b - a;

  // INV-05
  const expected = expectedSequence(
    capabilities,
    arch?.nLayers ?? 0,
    step.index === 0,
    step.stations,
  );
  const actual = step.stations.map(describeStation);
  if (actual.length !== expected.length || actual.some((entry, i) => entry !== expected[i])) {
    out.add('INV-05', stepPath, `Stationen [${actual.join(', ')}] statt [${expected.join(', ')}]`);
  }

  step.stations.forEach((station, k) => {
    const stationPath = `${stepPath}/stations/${k}`;
    // INV-06
    if (!capabilities.has(station.kind)) {
      out.add('INV-06', stationPath, `Station ${station.kind} fehlt in engine.capabilities`);
    }
    // INV-07
    if (station.kind === 'tokenize' && Array.isArray(station['tokens'])) {
      const tokens = station['tokens'] as SToken[];
      if (step.index === 0 && !sameTokens(tokens, step.contextTokens)) {
        out.add('INV-07', stationPath, 'tokenize.tokens weicht von contextTokens ab');
      }
    }
    // INV-10, INV-13 (Verteilungen und vocabSize)
    if (Array.isArray(station['distribution'])) {
      const distribution = station['distribution'] as SCandidate[];
      checkDistribution(distribution, stationPath, out);
      if (arch !== null) {
        distribution.forEach((candidate, j) => {
          if (candidate.token.id >= arch.vocabSize) {
            out.add(
              'INV-13',
              `${stationPath}/distribution/${j}/token`,
              `token.id ${candidate.token.id} ≥ vocabSize ${arch.vocabSize}`,
            );
          }
        });
      }
    }
    // INV-18
    if (station.kind === 'moe' && arch !== null) {
      checkRouting(station, n, arch, stationPath, out);
    }
    // INV-17
    if (station.kind === 'residual' && Array.isArray(station['lens'])) {
      checkLens(station['lens'] as SCandidate[], `${stationPath}/lens`, arch, out);
    }
    if (station.kind === 'logits' && arch !== null) {
      const vocabSize = station['vocabSize'];
      if (typeof vocabSize === 'number' && vocabSize !== arch.vocabSize) {
        out.add('INV-13', stationPath, `vocabSize ${vocabSize} statt ${arch.vocabSize}`);
      }
    }
    // INV-01, INV-08, INV-09
    const shapes = arch === null ? {} : tensorShapes(station, n, b, arch);
    for (const [field, value] of Object.entries(station)) {
      if (!isTensor(value)) continue;
      const tensorPath = `${stationPath}/${field}`;
      const values = checkTensorData(value, tensorPath, out);
      const expectedShape = shapes[field];
      if (expectedShape !== undefined && !sameShape(value.shape, expectedShape)) {
        out.add(
          'INV-08',
          tensorPath,
          `Form ${describeShape(value.shape)} statt ${describeShape(expectedShape)}`,
        );
      }
      if (station.kind === 'attention' && field === 'weights' && values !== undefined) {
        checkCausal(values, value.shape, a, tensorPath, out);
      }
    }
  });

  // INV-11
  const sample = step.stations.find((station) => station.kind === 'sample');
  if (sample !== undefined) {
    const chosen = sample['chosen'] as SToken | undefined;
    const distribution = (sample['distribution'] as SCandidate[] | undefined) ?? [];
    if (!sameToken(chosen, step.chosen)) {
      out.add('INV-11', stepPath, 'sample.chosen weicht von chosen ab');
    }
    if (!distribution.some((candidate) => sameToken(candidate.token, step.chosen))) {
      out.add('INV-11', stepPath, 'chosen fehlt in sample.distribution');
    }
  }
}

function checkSteps(trace: STrace, out: Collector): void {
  const { architecture: arch, eosTokenId: eos } = trace.engine;
  trace.steps.forEach((step, i) => {
    const stepPath = `/steps/${i}`;
    // INV-02
    if (step.index !== i) {
      out.add('INV-02', stepPath, `index ${step.index} statt ${i}`);
    }
    const length = step.contextTokens.length;
    // INV-03
    const previous = trace.steps[i - 1];
    if (previous !== undefined) {
      const chain = [...previous.contextTokens, previous.chosen];
      if (!sameTokens(step.contextTokens, chain)) {
        out.add('INV-03', stepPath, 'contextTokens ≠ vorheriger Kontext + vorheriges chosen');
      }
    }
    // INV-04
    const [a, b] = step.newPositions;
    const expected = i === 0 ? [0, length] : [length - 1, length];
    if (a !== expected[0] || b !== expected[1]) {
      out.add(
        'INV-04',
        stepPath,
        `newPositions [${String(a)}, ${String(b)}] statt [${expected.join(', ')}]`,
      );
    }
    // INV-13 (Kontextlänge, Token-IDs)
    if (arch !== null) {
      if (length > arch.contextLength) {
        out.add('INV-13', stepPath, `Kontext ${length} > contextLength ${arch.contextLength}`);
      }
      const tokens = [...step.contextTokens, step.chosen];
      const tokenize = step.stations.find((station) => station.kind === 'tokenize');
      if (tokenize !== undefined && Array.isArray(tokenize['tokens'])) {
        tokens.push(...(tokenize['tokens'] as SToken[]));
      }
      const outside = tokens.find((token) => token.id >= arch.vocabSize);
      if (outside !== undefined) {
        out.add('INV-13', stepPath, `token.id ${outside.id} ≥ vocabSize ${arch.vocabSize}`);
      }
    }
    // INV-15
    const meaningful = [...step.contextTokens, step.chosen].some((token) => token.id !== eos);
    if (meaningful && step.text.length === 0) {
      out.add('INV-15', stepPath, 'text ist leer');
    }
    checkStepStations(trace, step, stepPath, out);
  });
}

function checkEngine(trace: STrace, out: Collector): void {
  const { architecture: arch, capabilities, eosTokenId: eos } = trace.engine;
  // INV-06 (Interna brauchen eine Architektur, moe dazu nExperts und topK)
  if (arch === null && capabilities.some((kind) => INTERNAL_KINDS.includes(kind))) {
    out.add('INV-06', '/engine', 'Fähigkeiten mit Interna, aber architecture ist null');
  }
  if (arch !== null && capabilities.includes('moe')) {
    if (arch.nExperts === undefined || arch.topK === undefined) {
      out.add('INV-06', '/engine/architecture', 'moe ohne nExperts und topK');
    } else if (arch.topK > arch.nExperts) {
      out.add(
        'INV-06',
        '/engine/architecture/topK',
        `topK ${arch.topK} > nExperts ${arch.nExperts}`,
      );
    }
  }
  // INV-13 (eosTokenId)
  if (arch !== null && eos !== null && eos >= arch.vocabSize) {
    out.add('INV-13', '/engine/eosTokenId', `eosTokenId ${eos} ≥ vocabSize ${arch.vocabSize}`);
  }
}

/** INV-12: Ende des Laufs. */
function checkEnd(trace: STrace, out: Collector): void {
  const { steps, maxTokens, finishReason } = trace;
  const eos = trace.engine.eosTokenId;
  const last = steps[steps.length - 1];
  const earlyEos = steps.slice(0, -1).findIndex((step) => step.chosen.id === eos);
  if (eos !== null && earlyEos >= 0) {
    out.add('INV-12', `/steps/${earlyEos}/chosen`, 'EOS vor dem letzten Schritt');
  }
  const hasError = trace.error !== undefined;
  if (hasError !== (finishReason === 'error')) {
    out.add('INV-12', '/error', 'error ist genau bei finishReason "error" gesetzt');
  }
  switch (finishReason) {
    case 'eos':
      if (eos === null) {
        out.add('INV-12', '/finishReason', 'eos, aber engine.eosTokenId ist null');
      } else if (last === undefined || last.chosen.id !== eos) {
        out.add('INV-12', '/finishReason', 'eos, aber das letzte chosen ist nicht EOS');
      }
      if (steps.length < 1 || steps.length > maxTokens) {
        out.add('INV-12', '/steps', `eos mit ${steps.length} Schritten`);
      }
      break;
    case 'max-tokens':
      if (steps.length !== maxTokens) {
        out.add('INV-12', '/steps', `max-tokens mit ${steps.length} statt ${maxTokens} Schritten`);
      }
      if (last !== undefined && last.chosen.id === eos) {
        out.add('INV-12', '/finishReason', 'max-tokens, aber das letzte chosen ist EOS');
      }
      break;
    case 'aborted':
    case 'error':
      if (steps.length >= maxTokens) {
        out.add('INV-12', '/steps', `${finishReason} mit ${steps.length} ≥ ${maxTokens} Schritten`);
      }
      break;
    default:
      break;
  }
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

const utf8 = new TextEncoder();
/** Nicht fatal wie der Tokenizer: unvollständige Folgen werden zu U+FFFD. */
const lossyUtf8 = new TextDecoder('utf-8');

/** INV-16 für ein Pre-Token: Bytes, Stufen, Ränge und IDs passen zusammen. */
function checkBpeWord(word: SBpeWord, path: string, out: Collector): void {
  if (!sameNumbers(word.bytes, [...utf8.encode(word.text)])) {
    out.add('INV-16', `${path}/bytes`, 'bytes sind nicht das UTF-8 von text');
  }
  if (
    !sameNumbers(
      word.stages[0]?.map((symbol) => symbol.length) ?? [],
      word.bytes.map(() => 1),
    )
  ) {
    out.add('INV-16', `${path}/stages/0`, 'stages[0] besteht nicht aus Einzelbytes');
  }
  word.stages.forEach((stage, s) => {
    if (!sameNumbers(stage.flat(), word.bytes)) {
      out.add('INV-16', `${path}/stages/${s}`, `Stufe ${s} ergibt verkettet nicht bytes`);
    }
    const previous = word.stages[s - 1];
    if (previous !== undefined && stage.length >= previous.length) {
      out.add('INV-16', `${path}/stages/${s}`, `Stufe ${s} hat nicht weniger Symbole als ${s - 1}`);
    }
  });
  if (word.ranks.length !== word.stages.length - 1) {
    out.add(
      'INV-16',
      `${path}/ranks`,
      `${word.ranks.length} Ränge für ${word.stages.length} Stufen`,
    );
  }
  if (word.ranks.some((rank, i) => i > 0 && rank <= (word.ranks[i - 1] ?? rank))) {
    out.add('INV-16', `${path}/ranks`, 'Ränge sind nicht streng steigend');
  }
  if (word.ids.length !== (word.stages.at(-1)?.length ?? 0)) {
    out.add('INV-16', `${path}/ids`, 'ids passt nicht zur letzten Stufe');
  }
}

/** INV-16: BPE-Details der tokenize-Station (eigenes Glied, Traces ohne bpe laufen durch). */
function checkBpe(trace: STrace, out: Collector): void {
  trace.steps[0]?.stations.forEach((station, i) => {
    const bpe = station['bpe'];
    if (station.kind !== 'tokenize' || !isRecord(bpe)) return;
    const path = `/steps/0/stations/${i}/bpe`;
    const words = bpe['words'] as SBpeWord[];
    const tokens = station['tokens'] as SToken[];
    if (words.map((word) => word.text).join('') !== trace.prompt) {
      out.add('INV-16', `${path}/words`, 'Die Wörter ergeben verkettet nicht den Prompt');
    }
    words.forEach((word, k) => checkBpeWord(word, `${path}/words/${k}`, out));
    const ids = words.flatMap((word) => word.ids);
    if (
      !sameNumbers(
        ids,
        tokens.map((token) => token.id),
      )
    ) {
      out.add('INV-16', `${path}/words`, 'Die ids ergeben nicht die Token-IDs');
      return;
    }
    const finals = words.flatMap((word) => word.stages.at(-1) ?? []);
    tokens.forEach((token, j) => {
      const bytes = finals[j];
      if (bytes !== undefined && lossyUtf8.decode(Uint8Array.from(bytes)) !== token.text) {
        out.add('INV-16', `${path}/words`, `Token ${j}: text passt nicht zu den Bytes`);
      }
    });
  });
}

export function checkInvariants(serialized: unknown): ImportIssue[] {
  if (!isRecord(serialized)) {
    return [];
  }
  const trace = serialized as unknown as STrace;
  if (!isRecord(trace.engine) || !Array.isArray(trace.steps)) {
    return [];
  }
  const out = new Collector();
  checkEngine(trace, out);
  checkSteps(trace, out);
  checkEnd(trace, out);
  checkBpe(trace, out);
  return out.issues;
}
