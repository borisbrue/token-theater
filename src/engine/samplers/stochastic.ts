import type { LogitsStation, SampleStation } from '../../trace/types';
import {
  drawIndex,
  transformDistribution,
  validateSettings,
  type SamplingSettings,
} from '../../sampling/transform';
import type { Rng, Sampler } from '../types';

/**
 * Zufalls-Sampler mit Temperatur, Top-k und Top-p (SPEC-0004 FR-04, CON-0010 S-08). Zieht je
 * Schritt genau einmal rng.next() (SA-02); der Wurf liegt damit sichtbar im Trace.
 */
export class StochasticSampler implements Sampler {
  readonly strategy = 'sample';
  readonly params: { temperature: number; topK: number; topP: number };

  constructor(settings: SamplingSettings) {
    validateSettings(settings);
    this.params = { temperature: settings.temperature, topK: settings.topK, topP: settings.topP };
  }

  sample(logits: LogitsStation, rng: Rng): SampleStation {
    const distribution = transformDistribution(logits.distribution, this.params);
    const random = rng.next();
    const chosen = distribution[drawIndex(distribution, random)];
    if (chosen === undefined) throw new Error('Die Verteilung ist leer');
    return { kind: 'sample', distribution, random, chosen: { ...chosen.token } };
  }
}
