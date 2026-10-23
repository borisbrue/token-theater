/** Fehler beim Laden und Rechnen der GPT-2-Engine (SPEC-0006 §3.3, CON-0014). */

export type Gpt2LoadErrorKind = 'network' | 'format' | 'crash';

export class Gpt2LoadError extends Error {
  readonly kind: Gpt2LoadErrorKind;

  constructor(kind: Gpt2LoadErrorKind, message: string) {
    super(message);
    this.name = 'Gpt2LoadError';
    this.kind = kind;
  }
}

export function invalidWeights(reason: string): Gpt2LoadError {
  return new Gpt2LoadError('format', `Die Gewichtsdatei ist ungültig: ${reason}.`);
}

export function invalidConfig(reason: string): Gpt2LoadError {
  return new Gpt2LoadError('format', `Die Modellkonfiguration ist ungültig: ${reason}.`);
}

export function workerCrashed(): Gpt2LoadError {
  return new Gpt2LoadError('crash', 'Der GPT-2-Worker ist abgestürzt.');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
