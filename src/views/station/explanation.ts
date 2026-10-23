import type { Architecture } from '../../trace/types';

/** Die Modellzahlen, die die Erklärtexte nennen (SPEC-0009 §3.4). */
export interface ModelFacts {
  vocabSize: number;
  dModel: number;
  dMlp: number;
  nHeads: number;
  nLayers: number;
}

export function modelFacts(architecture: Architecture | null): ModelFacts | null {
  if (architecture === null) return null;
  const { vocabSize, dModel, dMlp, nHeads, nLayers } = architecture;
  return { vocabSize, dModel, dMlp, nHeads, nLayers };
}
