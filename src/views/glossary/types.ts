/** Ein Eintrag des Glossars (SPEC-0010 §3.4): Bedeutung und wo man den Begriff in der App sieht. */
export interface GlossaryEntry {
  term: string;
  meaning: string;
  inApp: string;
}

export type TermId =
  | 'token'
  | 'vocabulary'
  | 'bpe'
  | 'vector'
  | 'dimension'
  | 'tensor'
  | 'embedding'
  | 'layer'
  | 'attention'
  | 'head'
  | 'qkv'
  | 'mask'
  | 'kvCache'
  | 'residual'
  | 'layerNorm'
  | 'norm'
  | 'mlp'
  | 'hidden'
  | 'neuron'
  | 'gelu'
  | 'logit'
  | 'softmax'
  | 'logitLens'
  | 'candidate'
  | 'sampling'
  | 'greedy'
  | 'temperature'
  | 'topK'
  | 'topP'
  | 'seed'
  | 'trace'
  | 'step'
  | 'station';

export type Glossary = Readonly<Record<TermId, GlossaryEntry>>;

/** Was eine Erklärung braucht: die Einträge und das Präfix „In der App: “. */
export interface TermLabels {
  entries: Glossary;
  inApp: string;
}

export function isTermId(glossary: Glossary, id: string): id is TermId {
  return Object.prototype.hasOwnProperty.call(glossary, id);
}
