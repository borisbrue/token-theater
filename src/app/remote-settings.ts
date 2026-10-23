import { DIALECT_MAX_TOP_N, type Dialect } from './engine-factory';

/**
 * Server-Einstellungen der App (SPEC-0005 §3.6/§3.7, FR-07, FR-10): Presets aus
 * VITE_REMOTE_PRESETS (gitignorierte .env.local), Normalisierung und das Merken im Browser –
 * ohne API-Key.
 */

export type DialectChoice = 'auto' | Dialect;

export interface RemotePreset {
  name: string;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  dialect?: Dialect;
}

/** Was der Browser sich merkt; der API-Key gehört nie dazu. */
export interface StoredSettings {
  profile: string;
  baseUrl: string;
  model: string;
  dialect: DialectChoice;
}

const STORAGE_KEY = 'token-theater.remote';
const DIALECT_CHOICES: readonly DialectChoice[] = ['auto', 'legacy', 'content'];

export const DEFAULT_SETTINGS: StoredSettings = {
  profile: '',
  baseUrl: '',
  model: '',
  dialect: 'auto',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isDialect(value: unknown): value is Dialect {
  return value === 'legacy' || value === 'content';
}

/** JSON-Liste aus der Umgebung; alles Ungültige ergibt eine leere Liste bzw. fällt weg. */
export function parsePresets(raw: unknown): RemotePreset[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Kaputtes VITE_REMOTE_PRESETS: ohne Presets weiter (FR-07), die App bleibt nutzbar.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown): RemotePreset[] => {
    if (!isRecord(entry)) return [];
    const name = optionalString(entry['name']);
    const baseUrl = optionalString(entry['baseUrl']);
    if (name === undefined || baseUrl === undefined) return [];
    const preset: RemotePreset = { name, baseUrl: normalizeBaseUrl(baseUrl) };
    const model = optionalString(entry['model']);
    const apiKey = optionalString(entry['apiKey']);
    if (model !== undefined) preset.model = model;
    if (apiKey !== undefined) preset.apiKey = apiKey;
    if (isDialect(entry['dialect'])) preset.dialect = entry['dialect'];
    return [preset];
  });
}

export const PRESETS: readonly RemotePreset[] = parsePresets(
  import.meta.env['VITE_REMOTE_PRESETS'] as unknown,
);

/** Top-N: Ganzzahl in 1..Maximum des Dialekts, sonst (auch ohne Angabe) das Maximum. */
export function normalizeTopN(dialect: Dialect, topN?: number): number {
  const max = DIALECT_MAX_TOP_N[dialect];
  return topN !== undefined && Number.isInteger(topN) && topN >= 1 && topN <= max ? topN : max;
}

/** Ohne Leerraum und abschließende Schrägstriche: ".../v1/" → ".../v1". */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Gesperrter Speicher (privater Modus, Richtlinie): dann wird nichts gemerkt.
    return null;
  }
}

export function loadSettings(): StoredSettings {
  const raw = storage()?.getItem(STORAGE_KEY) ?? null;
  if (raw === null) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unlesbarer Eintrag aus einer älteren Version: mit den Vorgaben beginnen.
    return DEFAULT_SETTINGS;
  }
  if (!isRecord(parsed)) return DEFAULT_SETTINGS;
  const dialect = DIALECT_CHOICES.find((choice) => choice === parsed['dialect']) ?? 'auto';
  return {
    profile: typeof parsed['profile'] === 'string' ? parsed['profile'] : '',
    baseUrl: typeof parsed['baseUrl'] === 'string' ? parsed['baseUrl'] : '',
    model: typeof parsed['model'] === 'string' ? parsed['model'] : '',
    dialect,
  };
}

export function saveSettings(settings: StoredSettings): void {
  const { profile, baseUrl, model, dialect } = settings;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ profile, baseUrl, model, dialect }));
  } catch {
    // Voller oder gesperrter Speicher: Merken ist nur Komfort (SPEC-0005 §3.7).
  }
}
