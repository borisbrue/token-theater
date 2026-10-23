import type { Architecture, Station } from '../../trace/types';
import type { KernelName } from './kernel';

/** Kommandos zwischen Gpt2Engine (Hauptthread) und Worker (SPEC-0006 §3.2, Command). */

export type WorkerCommand =
  | { type: 'init'; config: unknown; weights: ArrayBuffer; topN: number }
  | { type: 'forward'; requestId: number; context: number[]; positions: [number, number] };

export type WorkerResponse =
  | { type: 'ready'; architecture: Architecture; kernel: KernelName }
  | { type: 'init-error'; message: string }
  | { type: 'stations'; requestId: number; stations: Station[] }
  | { type: 'forward-error'; requestId: number; message: string };
