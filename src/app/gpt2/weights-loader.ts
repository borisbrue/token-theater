import { texts } from '../texts';
import { modelUrl, type ModelEntry } from './models';

/**
 * Gewichte laden (SPEC-0006 §3.3, Chain of Responsibility): zuerst die Cache API, sonst fetch mit
 * stückweisem Lesen und Fortschritt; die Antwort landet parallel im Cache. Fortschritt geht als
 * Daten an die Oberfläche, die Texte stehen in texts.ts.
 */

export interface WeightsProgress {
  loadedBytes: number;
  totalBytes: number;
  fromCache: boolean;
}

export type WeightsLoadErrorKind = 'http' | 'network';

export class WeightsLoadError extends Error {
  readonly kind: WeightsLoadErrorKind;

  constructor(kind: WeightsLoadErrorKind, status?: number) {
    super(status === undefined ? texts.gpt2.networkError : texts.gpt2.httpError(status));
    this.name = 'WeightsLoadError';
    this.kind = kind;
  }
}

export interface LoaderDeps {
  fetch?: typeof fetch;
  /** null: ohne Cache laden. */
  caches?: CacheStorage | null;
}

const CACHE_NAME = 'token-theater-models-v1';

function defaultCaches(): CacheStorage | null {
  return typeof caches === 'undefined' ? null : caches;
}

async function openCache(storage: CacheStorage | null): Promise<Cache | null> {
  if (storage === null) return null;
  try {
    return await storage.open(CACHE_NAME);
  } catch {
    // Cache API gesperrt (privater Modus, unsicherer Kontext): das nächste Glied lädt übers Netz.
    return null;
  }
}

async function cached(cache: Cache | null, url: string): Promise<Response | null> {
  if (cache === null) return null;
  try {
    return (await cache.match(url)) ?? null;
  } catch {
    // Kaputter Cache-Eintrag: übers Netz laden.
    return null;
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}

/** Antwort aus dem Netz und das Schreiben in den Cache (wird nach dem Lesen abgewartet). */
async function fromNetwork(
  url: string,
  fetchFn: typeof fetch,
  cache: Cache | null,
  signal?: AbortSignal,
): Promise<{ response: Response; stored: Promise<void> }> {
  let response: Response;
  try {
    response = await fetchFn(url, signal === undefined ? {} : { signal });
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    throw new WeightsLoadError('network');
  }
  if (!response.ok) throw new WeightsLoadError('http', response.status);
  const stored =
    cache === null
      ? Promise.resolve()
      : cache.put(url, response.clone()).catch(() => {
          // Speicher voll oder Cache gesperrt: Laden klappt trotzdem, nur ohne Cache.
        });
  return { response, stored };
}

/** Liest den Body stückweise und meldet den Fortschritt. */
async function readBody(
  response: Response,
  total: number,
  fromCache: boolean,
  onProgress?: (p: WeightsProgress) => void,
): Promise<ArrayBuffer> {
  const length = Number(response.headers.get('Content-Length')) || total;
  if (response.body === null) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ loadedBytes: buffer.byteLength, totalBytes: length, fromCache });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loadedBytes: loaded, totalBytes: Math.max(length, loaded), fromCache });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

async function load(
  url: string,
  total: number,
  deps: Required<LoaderDeps>,
  cache: Cache | null,
  onProgress?: (p: WeightsProgress) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const hit = await cached(cache, url);
  if (hit !== null) {
    onProgress?.({ loadedBytes: 0, totalBytes: total, fromCache: true });
    return readBody(hit, total, true, onProgress);
  }
  onProgress?.({ loadedBytes: 0, totalBytes: total, fromCache: false });
  const { response, stored } = await fromNetwork(url, deps.fetch, cache, signal);
  const buffer = await readBody(response, total, false, onProgress);
  // Erst nach dem Schreiben weiter: so kann forgetModelFiles einen kaputten Eintrag sicher löschen.
  await stored;
  return buffer;
}

export async function loadModelFiles(
  entry: ModelEntry,
  onProgress?: (p: WeightsProgress) => void,
  signal?: AbortSignal,
  deps: LoaderDeps = {},
): Promise<{ config: unknown; weights: ArrayBuffer }> {
  const resolved: Required<LoaderDeps> = {
    fetch: deps.fetch ?? ((input, init) => fetch(input, init)),
    caches: deps.caches === undefined ? defaultCaches() : deps.caches,
  };
  const cache = await openCache(resolved.caches);
  const configBytes = await load(modelUrl(entry.config), 0, resolved, cache, undefined, signal);
  let config: unknown;
  try {
    config = JSON.parse(new TextDecoder().decode(configBytes));
  } catch {
    config = null;
  }
  const weights = await load(
    modelUrl(entry.weights),
    entry.bytes,
    resolved,
    cache,
    onProgress,
    signal,
  );
  return { config, weights };
}

/** Entfernt eine als ungültig erkannte Datei wieder aus dem Cache (§3.3). */
export async function forgetModelFiles(entry: ModelEntry, deps: LoaderDeps = {}): Promise<void> {
  const cache = await openCache(deps.caches === undefined ? defaultCaches() : deps.caches);
  await cache?.delete(modelUrl(entry.weights));
  await cache?.delete(modelUrl(entry.config));
}
