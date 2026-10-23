import { badFormat, httpError, unreachable } from './errors';

/** Injiziertes fetch (CON-0012 RM-04); Default ist das globale fetch. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface Connection {
  baseUrl: string;
  apiKey: string;
}

export const globalFetch: FetchLike = (url, init) => fetch(url, init);

/**
 * Eine JSON-Anfrage an `${baseUrl}${path}`. Netz- und HTTP-Fehler werden zu RemoteError; ein
 * Fehler bei abgebrochenem Signal bleibt, wie er ist (der Generator wertet ihn als Abbruch).
 */
export async function requestJson(
  fetchFn: FetchLike,
  connection: Connection,
  path: string,
  body: Record<string, unknown> | null,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${connection.apiKey}` };
  if (body !== null) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetchFn(`${connection.baseUrl}${path}`, {
      method: body === null ? 'GET' : 'POST',
      headers,
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw unreachable(connection.baseUrl);
  }
  if (!response.ok) throw httpError(response.status);
  try {
    return await response.json();
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw badFormat();
  }
}
