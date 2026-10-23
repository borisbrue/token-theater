import type {
  EngineInfo,
  FinishReason,
  GenerationStep,
  SamplingParams,
  Station,
  Token,
  Trace,
  TraceEvent,
} from './types';

/**
 * Builder für Traces (SPEC-0001 §3.5): `record` reicht jedes Event unverändert weiter und baut
 * nebenbei den Trace; `build` liefert ihn tief eingefroren, sobald done oder error angekommen
 * ist. Nicht abgeschlossene Schritte (Abbruch, Fehler) fehlen im Trace (CON-0002 INV-03).
 */

export interface RecorderDeps {
  idProvider(): string;
  /** ISO-8601-Zeitstempel. */
  clock(): string;
}

interface Header {
  id: string;
  createdAt: string;
  engine: EngineInfo;
  prompt: string;
  maxTokens: number;
  sampling: SamplingParams;
}

interface OpenStep {
  index: number;
  contextTokens: Token[];
  newPositions: [number, number];
  stations: Station[];
}

/** Tiefe Kopie reiner Daten; Float32Array wird kopiert, nie geteilt. */
function clone<T>(value: T): T {
  if (value instanceof Float32Array) {
    return new Float32Array(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => clone(item)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = clone(item);
    return copy as T;
  }
  return value;
}

/** Friert rekursiv ein; typisierte Arrays lassen sich nicht einfrieren und bleiben aus. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) {
    return value;
  }
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export class TraceRecorder {
  private header: Header | undefined;
  private readonly steps: GenerationStep[] = [];
  private open: OpenStep | undefined;
  private finish: { reason: FinishReason; error?: { message: string } } | undefined;

  constructor(private readonly deps: RecorderDeps) {}

  async *record(events: AsyncIterable<TraceEvent>): AsyncGenerator<TraceEvent, void, undefined> {
    for await (const event of events) {
      this.apply(event);
      yield event;
    }
  }

  private apply(event: TraceEvent): void {
    switch (event.type) {
      case 'run-start':
        this.header = {
          id: this.deps.idProvider(),
          createdAt: this.deps.clock(),
          engine: clone(event.engine),
          prompt: event.prompt,
          maxTokens: event.maxTokens,
          sampling: clone(event.sampling),
        };
        break;
      case 'step-start':
        this.open = {
          index: event.index,
          contextTokens: clone(event.contextTokens),
          newPositions: [event.newPositions[0], event.newPositions[1]],
          stations: [],
        };
        break;
      case 'station':
        this.open?.stations.push(clone(event.station));
        break;
      case 'step-end':
        if (this.open !== undefined) {
          this.steps.push({ ...this.open, chosen: clone(event.chosen), text: event.text });
          this.open = undefined;
        }
        break;
      case 'done':
        this.open = undefined;
        this.finish = { reason: event.finishReason };
        break;
      case 'error':
        this.open = undefined;
        this.finish = { reason: 'error', error: { message: event.message } };
        break;
    }
  }

  /** Der fertige, tief eingefrorene Trace. Wirft, solange done/error fehlt. */
  build(): Trace {
    if (this.header === undefined || this.finish === undefined) {
      throw new Error('Trace unvollständig: kein done- oder error-Event empfangen');
    }
    const { error, reason } = this.finish;
    const trace: Trace = {
      schemaVersion: 1,
      id: this.header.id,
      createdAt: this.header.createdAt,
      engine: clone(this.header.engine),
      prompt: this.header.prompt,
      maxTokens: this.header.maxTokens,
      sampling: clone(this.header.sampling),
      steps: clone(this.steps),
      finishReason: reason,
      ...(error === undefined ? {} : { error: { ...error } }),
    };
    return deepFreeze(trace);
  }
}
