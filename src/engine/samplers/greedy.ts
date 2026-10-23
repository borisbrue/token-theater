import type { LogitsStation, SampleStation } from '../../trace/types';
import type { Sampler } from '../types';

/** Wählt das wahrscheinlichste Token; bei Gleichstand die niedrigste ID. Kein Zufall. */
export class GreedySampler implements Sampler {
  readonly strategy = 'greedy';

  sample(logits: LogitsStation): SampleStation {
    let best = logits.distribution[0];
    for (const candidate of logits.distribution) {
      if (
        best === undefined ||
        candidate.prob > best.prob ||
        (candidate.prob === best.prob && candidate.token.id < best.token.id)
      ) {
        best = candidate;
      }
    }
    if (best === undefined) {
      throw new Error('logits.distribution ist leer');
    }
    return {
      kind: 'sample',
      distribution: [...logits.distribution],
      random: null,
      chosen: best.token,
    };
  }
}
