import { DIALECTS, isRecord, logprobsOf, type DialectId } from './dialects';
import { badFormat, noLogprobs } from './errors';
import { globalFetch, requestJson, type Connection, type FetchLike } from './http';

/** Hilfen für die Einstellungen: Modelle auflisten, Dialekt erkennen (CON-0012 RE-11). */

export interface ClientDeps {
  fetch?: FetchLike;
}

export async function listModels(connection: Connection, deps: ClientDeps = {}): Promise<string[]> {
  const json = await requestJson(deps.fetch ?? globalFetch, connection, '/models', null);
  const data = isRecord(json) ? json['data'] : null;
  if (!Array.isArray(data)) throw badFormat();
  return data.flatMap((entry: unknown) => {
    const id = isRecord(entry) ? entry['id'] : null;
    return typeof id === 'string' ? [id] : [];
  });
}

/** Probe im content-Format (für beide Server sicher; die Zahl-Form bricht MLX-Server ab). */
export async function detectDialect(
  target: Connection & { model: string },
  deps: ClientDeps = {},
): Promise<DialectId> {
  const body = {
    model: target.model,
    prompt: 'Hallo',
    max_tokens: 1,
    temperature: 1,
    logprobs: true,
    top_logprobs: 1,
  };
  const json = await requestJson(deps.fetch ?? globalFetch, target, '/completions', body);
  logprobsOf(json);
  const dialect = DIALECTS.find((d) => d.matches(json));
  if (dialect === undefined) throw noLogprobs();
  return dialect.id;
}
