/** GPT-2-Modelle aus `models/index.json` (SPEC-0006 §3.3, FR-07). */

export interface ModelEntry {
  id: string;
  name: string;
  /** Pfade relativ zu `models/`. */
  config: string;
  weights: string;
  bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Gültige Einträge des Manifests; Ungültiges fällt weg. */
export function parseModelManifest(json: unknown): ModelEntry[] {
  const models = isRecord(json) ? json['models'] : null;
  if (!Array.isArray(models)) return [];
  return models.flatMap((entry: unknown): ModelEntry[] => {
    if (!isRecord(entry)) return [];
    const id = text(entry['id']);
    const name = text(entry['name']);
    const config = text(entry['config']);
    const weights = text(entry['weights']);
    const bytes = entry['bytes'];
    if (id === null || name === null || config === null || weights === null) return [];
    return [
      { id, name, config, weights, bytes: typeof bytes === 'number' && bytes > 0 ? bytes : 0 },
    ];
  });
}

export function modelUrl(path: string): string {
  return `${import.meta.env.BASE_URL}models/${path}`;
}

/** Manifest laden; fehlt es oder ist es kaputt, gibt es keine Modelle (Hinweis in der UI). */
export async function loadModelManifest(fetchFn: typeof fetch = fetch): Promise<ModelEntry[]> {
  try {
    const response = await fetchFn(modelUrl('index.json'));
    if (!response.ok) return [];
    return parseModelManifest(await response.json());
  } catch {
    // Kein Manifest erreichbar oder kein JSON: wie „keine Modelle“ behandeln (FR-09 Hinweis).
    return [];
  }
}
