import { genericRenderer, type StationRenderer } from '../station/StationView';
import { TokenizationView, type TokenizationLabels } from './TokenizationView';

/** Renderer der tokenize-Station für die Registry aus SPEC-0002 §3.8 (SPEC-0003 FR-12). */
export function createTokenizeRenderer(labels: TokenizationLabels): StationRenderer {
  return (context) => {
    const { station } = context;
    if (station.kind !== 'tokenize') return genericRenderer(context);
    return (
      <>
        <TokenizationView tokens={station.tokens} bpe={station.bpe ?? null} labels={labels} />
      </>
    );
  };
}
