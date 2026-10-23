import type { WorkerCommand, WorkerResponse } from './protocol';
import { createGpt2WorkerHandler } from './worker-handler';

/** Einstieg des GPT-2-Web-Workers (SPEC-0006 §3.2). */

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;
const handle = createGpt2WorkerHandler((response, transfer) =>
  scope.postMessage(response, transfer ?? []),
);
scope.onmessage = (event) => handle(event.data);
