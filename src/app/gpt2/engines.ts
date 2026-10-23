import type { InferenceEngine } from '../../engine/types';
import { createEngine, type EngineDeps } from '../engine-factory';
import { getGpt2Tokenizer } from '../tokenizer/gpt2-loader';
import type { ModelEntry } from './models';
import { forgetModelFiles, loadModelFiles, type WeightsProgress } from './weights-loader';

/**
 * Geladene GPT-2-Engines je Modell (SPEC-0006 FR-09): einmal laden, für weitere Läufe behalten.
 * Fehlschläge und Abbrüche werden nicht behalten.
 */

const loaded = new Map<string, InferenceEngine>();

function isFormatError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'Gpt2LoadError' &&
    (error as Error & { kind?: unknown }).kind === 'format'
  );
}

export async function gpt2EngineFor(
  entry: ModelEntry,
  deps: EngineDeps,
  onProgress?: (p: WeightsProgress) => void,
  signal?: AbortSignal,
): Promise<InferenceEngine> {
  const existing = loaded.get(entry.id);
  if (existing !== undefined) return existing;
  const tokenizer = await getGpt2Tokenizer();
  const engine = createEngine('gpt2', deps, {
    gpt2: {
      model: entry.name,
      tokenizer,
      loadWeights: (loadSignal) => loadModelFiles(entry, onProgress, loadSignal),
    },
  });
  try {
    await engine.load(undefined, signal);
  } catch (error) {
    engine.dispose();
    // Ungültige Datei: nicht aus dem Cache weiterverwenden (SPEC-0006 §3.3).
    if (isFormatError(error)) await forgetModelFiles(entry);
    throw error;
  }
  loaded.set(entry.id, engine);
  return engine;
}

/**
 * Nach einem Lauf mit Fehler (z. B. Worker-Absturz) die Engine verwerfen; der nächste Lauf lädt
 * neu (aus dem Browser-Cache).
 */
export function releaseGpt2Engine(entry: ModelEntry): void {
  loaded.get(entry.id)?.dispose();
  loaded.delete(entry.id);
}
