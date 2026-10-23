import { GreedySampler } from '../engine/samplers/greedy';
import { StochasticSampler } from '../engine/samplers/stochastic';
import type { Sampler } from '../engine/types';
import {
  DEFAULT_SETTINGS,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  type SamplingSettings,
} from '../sampling/transform';
import { normalizeTopK, TOP_P_MIN } from '../views/distribution/sampling-input';

export { normalizeTopK, TOP_P_MIN };

/**
 * Sampling-Wahl des Formulars und ihre Fabrik (SPEC-0004 §3.5, Factory Method): Normalisierung,
 * Klassenwahl und Seed an einer Stelle; das Formular kennt keine Sampler-Klassen.
 */

export type Strategy = 'greedy' | 'sample';

export interface SamplingChoice {
  strategy: Strategy;
  settings: SamplingSettings;
  seed: number;
}

export const DEFAULT_SEED = 42;
export const SEED_MAX = 4_294_967_295;

export const DEFAULT_CHOICE: SamplingChoice = {
  strategy: 'greedy',
  settings: DEFAULT_SETTINGS,
  seed: DEFAULT_SEED,
};

function clampedInteger(raw: string, max: number, fallback: number): number {
  const value = Number.parseFloat(raw);
  if (raw.trim() === '' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

/** Abrunden, auf 0–4294967295 begrenzen, sonst 42. */
export function normalizeSeed(raw: string): number {
  return clampedInteger(raw, SEED_MAX, DEFAULT_SEED);
}

function clamp(raw: string, min: number, max: number, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeTemperature(raw: string): number {
  return clamp(raw, TEMPERATURE_MIN, TEMPERATURE_MAX, DEFAULT_SETTINGS.temperature);
}

export function normalizeTopP(raw: string): number {
  return clamp(raw, TOP_P_MIN, 1, DEFAULT_SETTINGS.topP);
}

export function createSampler(choice: SamplingChoice): Sampler {
  return choice.strategy === 'greedy'
    ? new GreedySampler()
    : new StochasticSampler(choice.settings);
}
