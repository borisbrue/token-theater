import {
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  TOP_K_MAX,
  type SamplingSettings,
} from '../../sampling/transform';

/**
 * Eingabegrenzen und Normalisierung der Sampling-Regler, gemeinsam für Formular (App) und
 * Sampling-Labor (View); Views importieren nicht aus app/, deshalb liegt es hier.
 */

export const TOP_P_MIN = 0.05;

/** Abrunden, auf 0–100 begrenzen, sonst 0 (aus). */
export function normalizeTopK(raw: string): number {
  const value = Number.parseFloat(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return 0;
  return Math.min(TOP_K_MAX, Math.max(0, Math.floor(value)));
}

/** Nicht werfende Gegenstück zu validateSettings für Werte aus einem (importierten) Trace. */
export function settingsFrom(params: Readonly<Record<string, unknown>>): SamplingSettings | null {
  const { temperature, topK, topP } = params;
  if (typeof temperature !== 'number' || typeof topK !== 'number' || typeof topP !== 'number') {
    return null;
  }
  const valid =
    temperature >= TEMPERATURE_MIN &&
    temperature <= TEMPERATURE_MAX &&
    Number.isInteger(topK) &&
    topK >= 0 &&
    topK <= TOP_K_MAX &&
    topP > 0 &&
    topP <= 1;
  return valid ? { temperature, topK, topP } : null;
}
