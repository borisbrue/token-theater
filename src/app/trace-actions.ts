import { generate } from '../engine/generate';
import { createRng } from '../engine/rng';
import { TraceRecorder } from '../trace/recorder';
import { deserializeTrace, serializeTrace, TraceImportError } from '../trace/serialize';
import type { Trace } from '../trace/types';
import type { InferenceEngine } from '../engine/types';
import { createEngine, detectDialect, type EngineDeps } from './engine-factory';
import { normalizeBaseUrl, normalizeTopN, type DialectChoice } from './remote-settings';
import { gpt2EngineFor, releaseGpt2Engine } from './gpt2/engines';
import type { ModelEntry } from './gpt2/models';
import type { WeightsProgress } from './gpt2/weights-loader';
import { createSampler, DEFAULT_CHOICE, type SamplingChoice } from './sampling-choice';
import { texts } from './texts';

/** Erzeugen, Export und Import für den Trace-Inspector (SPEC-0001 FR-10). */

export const DEFAULT_MAX_TOKENS = 8;
export const MIN_MAX_TOKENS = 1;
export const MAX_MAX_TOKENS = 32;
const DETAIL_LIMIT = 5;

/** CON-0003 UI-05: abrunden, auf 1–32 begrenzen, leer oder ungültig → 8. */
export function normalizeMaxTokens(raw: string): number {
  const value = Number.parseFloat(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) {
    return DEFAULT_MAX_TOKENS;
  }
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.floor(value)));
}

function appDeps(): EngineDeps {
  return {
    createRng,
    idProvider: () => crypto.randomUUID(),
    clock: () => new Date().toISOString(),
  };
}

/** Welche Engine einen Lauf rechnet (SPEC-0005 §3.7). */
export type EngineChoice =
  | { kind: 'mock' }
  | {
      kind: 'remote';
      baseUrl: string;
      apiKey: string;
      model: string;
      dialect: DialectChoice;
      /** Ohne Angabe das Maximum des Dialekts. */
      topN?: number;
    }
  | { kind: 'gpt2'; model: ModelEntry };

export interface GenerateOptions {
  engine?: EngineChoice;
  signal?: AbortSignal;
  /** Beobachter des Fortschritts (Observer): Schritt `step` (1-basiert) von `total` beginnt. */
  onProgress?: (step: number, total: number) => void;
  /** Fortschritt beim Laden der GPT-2-Gewichte (SPEC-0006 §3.3). */
  onLoadProgress?: (progress: WeightsProgress) => void;
}

interface PreparedEngine {
  engine: InferenceEngine;
  /** Geladene GPT-2-Engines bleiben für weitere Läufe erhalten (SPEC-0006 FR-09). */
  keep: boolean;
}

/** Baut die Engine; bei „Automatisch“ erkennt eine Probe-Anfrage den Dialekt (SPEC-0005 §3.3). */
async function engineFor(
  choice: EngineChoice,
  deps: EngineDeps,
  options: GenerateOptions,
): Promise<PreparedEngine> {
  if (choice.kind === 'mock') return { engine: createEngine('mock', deps), keep: false };
  if (choice.kind === 'gpt2') {
    const engine = await gpt2EngineFor(choice.model, deps, options.onLoadProgress, options.signal);
    return { engine, keep: true };
  }
  const connection = { baseUrl: normalizeBaseUrl(choice.baseUrl), apiKey: choice.apiKey };
  const dialect =
    choice.dialect === 'auto'
      ? await detectDialect({ ...connection, model: choice.model })
      : choice.dialect;
  const engine = createEngine('remote', deps, {
    remote: {
      ...connection,
      model: choice.model,
      dialect,
      topN: normalizeTopN(dialect, choice.topN),
    },
  });
  return { engine, keep: false };
}

/**
 * Erzeugt einen Trace. Fehler vor dem ersten Schritt (Dialekt-Probe, Tokenisieren) werfen;
 * Fehler während des Laufs stehen im Trace (`finishReason: 'error'`), ein Abbruch ergibt
 * `aborted`. Wird schon während der Dialekt-Probe abgebrochen, gibt es keinen Lauf: `null`
 * (kein Trace, kein Fehler).
 */
export async function generateTrace(
  prompt: string,
  maxTokens: number,
  sampling: SamplingChoice = DEFAULT_CHOICE,
  options: GenerateOptions = {},
): Promise<Trace | null> {
  const deps = appDeps();
  const { signal } = options;
  let prepared: PreparedEngine;
  try {
    prepared = await engineFor(options.engine ?? { kind: 'mock' }, deps, options);
  } catch (error) {
    if (signal?.aborted === true) return null;
    throw error;
  }
  if (signal?.aborted === true) return null;
  const { engine, keep } = prepared;
  if (!keep) await engine.load();
  try {
    const recorder = new TraceRecorder(deps);
    const events = generate(
      engine,
      createSampler(sampling),
      { prompt, maxTokens, seed: sampling.seed },
      deps,
      options.signal,
    );
    for await (const event of recorder.record(events)) {
      if (event.type === 'step-start') options.onProgress?.(event.index + 1, maxTokens);
    }
    const trace = recorder.build();
    const choice = options.engine;
    if (trace.finishReason === 'error' && choice?.kind === 'gpt2') releaseGpt2Engine(choice.model);
    return trace;
  } finally {
    if (!keep) engine.dispose();
  }
}

/** Startet den Download von `<id>.trace.json`. */
export function downloadTrace(trace: Trace): void {
  const blob = new Blob([serializeTrace(trace)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${trace.id}.trace.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ErrorView {
  message: string;
  details: string[];
}

export type ImportResult = { ok: true; trace: Trace } | { ok: false; error: ErrorView };

function versionText(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    const version = (parsed as Record<string, unknown>)['schemaVersion'];
    if (version === undefined) return texts.errors.versionMissing;
    return texts.errors.versionUnsupported(
      typeof version === 'number' ? String(version) : JSON.stringify(version),
    );
  } catch {
    return texts.errors.versionMissing;
  }
}

function withLimit(lines: string[]): string[] {
  return lines.length <= DETAIL_LIMIT
    ? lines
    : [...lines.slice(0, DETAIL_LIMIT), texts.errors.more(lines.length - DETAIL_LIMIT)];
}

/** Bildet TraceImportError auf die Texte aus texts.ts ab (CON-0003 Fehlermeldungen, UI-03). */
export function describeImportError(error: TraceImportError, content: string): ErrorView {
  switch (error.kind) {
    case 'parse':
      return { message: texts.errors.parse, details: [] };
    case 'version':
      return { message: versionText(content), details: [] };
    case 'schema':
      return {
        message: texts.errors.schema,
        details: withLimit(error.errors.map((e) => `${e.path}: ${e.message}`)),
      };
    case 'semantic':
      return {
        message: texts.errors.semantic,
        details: withLimit(
          error.errors.map((e) => `${e.path} (${e.invariant ?? '?'}): ${e.message}`),
        ),
      };
  }
}

export function importTrace(content: string): ImportResult {
  try {
    return { ok: true, trace: deserializeTrace(content) };
  } catch (error) {
    if (error instanceof TraceImportError) {
      return { ok: false, error: describeImportError(error, content) };
    }
    throw error;
  }
}
