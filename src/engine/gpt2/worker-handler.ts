import type { Station } from '../../trace/types';
import { parseGpt2Config, type Gpt2Config } from './config';
import { selectKernel } from './kernel';
import { Gpt2Model } from './model';
import type { WorkerCommand, WorkerResponse } from './protocol';
import { parseSafetensors } from './safetensors';
import { mapGpt2Weights } from './weights';

/**
 * Verarbeitung der Worker-Kommandos (SPEC-0006 §3.2, CON-0014 G-06); im Worker und in Tests
 * (In-Process-Worker) derselbe Code.
 */

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function architectureOf(config: Gpt2Config) {
  const { nLayers, nHeads, dModel, dMlp, vocabSize, contextLength } = config;
  return { nLayers, nHeads, dModel, dMlp, vocabSize, contextLength };
}

/** Puffer der Tensoren, damit postMessage sie überträgt statt kopiert. */
function transferables(stations: readonly Station[]): Transferable[] {
  const buffers = new Set<ArrayBufferLike>();
  for (const station of stations) {
    for (const value of Object.values(station)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'data' in value &&
        value.data instanceof Float32Array
      ) {
        buffers.add(value.data.buffer);
      }
    }
  }
  return [...buffers].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
}

export function createGpt2WorkerHandler(
  post: (response: WorkerResponse, transfer?: Transferable[]) => void,
): (command: WorkerCommand) => void {
  let model: Gpt2Model | null = null;
  return (command) => {
    switch (command.type) {
      case 'init':
        try {
          const config = parseGpt2Config(command.config);
          // Der WASM-Kern kopiert die Gewichte; danach hält nichts mehr den Datei-Puffer.
          const { kernel, weights } = selectKernel(
            config,
            mapGpt2Weights(parseSafetensors(command.weights), config),
          );
          model = new Gpt2Model(config, weights, { topN: command.topN, kernel });
          post({ type: 'ready', architecture: architectureOf(config), kernel: kernel.name });
        } catch (error) {
          model = null;
          post({ type: 'init-error', message: messageOf(error) });
        }
        return;
      case 'forward': {
        const { requestId } = command;
        if (model === null) {
          post({
            type: 'forward-error',
            requestId,
            message: 'Das GPT-2-Modell ist nicht geladen.',
          });
          return;
        }
        try {
          const stations = model.forward(command.context, command.positions);
          post({ type: 'stations', requestId, stations }, transferables(stations));
        } catch (error) {
          post({ type: 'forward-error', requestId, message: messageOf(error) });
        }
        return;
      }
    }
  };
}
