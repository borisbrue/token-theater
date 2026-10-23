import { Fragment, type ReactNode } from 'react';

import type {
  Candidate,
  GenerationStep,
  SamplingParams,
  Station,
  StationKind,
  Tensor,
} from '../../trace/types';
import { Term } from '../glossary/Term';
import { TermText } from '../glossary/TermText';
import type { TermId, TermLabels } from '../glossary/types';
import type { ModelFacts } from './explanation';
import { layerMap, type LayerPlace } from './layer-map';
import { LayerMap, type LayerMapLabels } from './LayerMap';
import { DEFAULT_SELECTION, type StationSelection } from './selection';
import { stationName, type StationNameLabels } from './station-name';

export interface StationViewLabels extends StationNameLabels {
  region: string;
  position: (step: number, station: number, count: number) => string;
  tensors: string;
  candidates: string;
  explanations: Readonly<Record<StationKind, string>>;
  /** Zusammenfassung des aufklappbaren Erklärtexts (SPEC-0009 §3.4). */
  moreSummary: string;
  /** Ausführlicher Erklärtext je Station, mit Modellzahlen, falls bekannt. */
  more: (station: Station, facts: ModelFacts | null) => string;
  /** Zeile zum Teil im Layer (SPEC-0010 §3.3). */
  layerPart: (station: Station, place: LayerPlace | null) => string;
  layerMap: LayerMapLabels;
  /** Glossar für markierte Begriffe und die Liste „Begriffe“ (SPEC-0010 §3.5–3.7). */
  glossary: TermLabels & {
    termList: string;
    byStation: Readonly<Record<StationKind, readonly TermId[]>>;
  };
}

export interface StationRenderContext {
  station: Station;
  labels: StationViewLabels;
  /** Sampling des Traces (SPEC-0004 §3.8); bestehende Renderer ignorieren es. */
  sampling: SamplingParams | null;
  /** Der aktuelle Schritt (SPEC-0007 §3.8); null nur ohne Trace-Kontext. */
  step: GenerationStep | null;
  /** Die Schritte vor dem aktuellen, nur lesend (KV-Cache-Zeilen). */
  earlierSteps: readonly GenerationStep[];
  /** Auswahl, die der Player hält (Mediator). */
  selection: StationSelection;
  select: (patch: Partial<StationSelection>) => void;
}

/** Inhalt einer Station; SPEC-0004/0007 registrieren eigene Renderer (SPEC-0002 §3.8). */
export type StationRenderer = (context: StationRenderContext) => ReactNode;
export type StationRenderers = Partial<Record<StationKind, StationRenderer>>;

const TENSOR_FIELDS: Record<StationKind, readonly string[]> = {
  tokenize: [],
  embed: ['token', 'position', 'sum'],
  attention: ['lnIn', 'q', 'k', 'v', 'weights', 'out'],
  mlp: ['lnIn', 'hidden', 'out'],
  residual: ['stream'],
  logits: [],
  sample: [],
};

function tensorsOf(station: Station): { name: string; shape: string }[] {
  const fields = station as unknown as Record<string, Tensor | undefined>;
  return TENSOR_FIELDS[station.kind].flatMap((name) => {
    const tensor = fields[name];
    return tensor === undefined ? [] : [{ name, shape: `[${tensor.shape.join(', ')}]` }];
  });
}

function topCandidates(station: Station): Candidate[] {
  return station.kind === 'logits' || station.kind === 'sample'
    ? station.distribution.slice(0, 3)
    : [];
}

/** Liste „Tensoren“ mit den Formen einer Station; auch die eigenen Ansichten zeigen sie. */
export function TensorList({ station, label }: { station: Station; label: string }) {
  const tensors = tensorsOf(station);
  if (tensors.length === 0) return null;
  return (
    <ul className="tensor-list" aria-label={label}>
      {tensors.map((t) => (
        <li key={t.name}>{`${t.name} ${t.shape}`}</li>
      ))}
    </ul>
  );
}

/** Generischer Renderer: Tensorformen, bei logits/sample die Top-3-Kandidaten. */
export const genericRenderer: StationRenderer = ({ station, labels }) => {
  const candidates = topCandidates(station);
  return (
    <>
      <TensorList station={station} label={labels.tensors} />
      {candidates.length > 0 && (
        <ol className="candidate-list" aria-label={labels.candidates}>
          {candidates.map((c) => (
            <li key={c.token.id}>{`${c.token.text} ${c.prob.toFixed(3)}`}</li>
          ))}
        </ol>
      )}
    </>
  );
};

export interface StationViewProps {
  frame: { step: number; station: number; count: number };
  station: Station;
  renderers?: StationRenderers;
  sampling?: SamplingParams | null;
  step?: GenerationStep | null;
  earlierSteps?: readonly GenerationStep[];
  selection?: StationSelection;
  select?: (patch: Partial<StationSelection>) => void;
  /** Modellzahlen für „Mehr dazu“; null, wenn der Trace keine Architektur kennt. */
  facts?: ModelFacts | null;
  labels: StationViewLabels;
}

const NO_STEPS: readonly GenerationStep[] = [];
const ignore = (): void => undefined;

/**
 * Stationsansicht (SPEC-0002 FR-11): Erklärsatz und „Mehr dazu“ einheitlich unter der Überschrift
 * (SPEC-0009), Layer-Karte im Kopf, Zeile zum Teil im Layer und Liste „Begriffe“ (SPEC-0010).
 */
export function StationView({
  frame,
  station,
  renderers = {},
  sampling = null,
  step = null,
  earlierSteps = NO_STEPS,
  selection = DEFAULT_SELECTION,
  select = ignore,
  facts = null,
  labels,
}: StationViewProps) {
  const render = renderers[station.kind] ?? genericRenderer;
  const map = step === null ? null : layerMap(step.stations, frame.station);
  const terms = labels.glossary;
  return (
    <section className="station-view panel active" aria-label={labels.region}>
      <div className="station-head">
        <p className="label station-position">
          {labels.position(frame.step, frame.station + 1, frame.count)}
        </p>
        {map !== null && <LayerMap model={map} labels={labels.layerMap} names={labels} />}
      </div>
      <h2>{stationName(station, labels)}</h2>
      {/* Neuer Schlüssel je Station: offene Erklärungen gehören zur Station, die sie zeigte. */}
      <Fragment key={`${frame.step}:${frame.station}`}>
        <p className="explanation">
          <TermText text={labels.explanations[station.kind]} labels={terms} />
        </p>
        <details className="explanation-more">
          <summary>{labels.moreSummary}</summary>
          <p>
            <TermText text={labels.more(station, facts)} labels={terms} />
          </p>
        </details>
        {map !== null && (
          <p className="layer-part">
            <TermText text={labels.layerPart(station, map.place)} labels={terms} />
          </p>
        )}
        <ul className="term-list" aria-label={terms.termList}>
          {terms.byStation[station.kind].map((id) => (
            <li key={id}>
              <Term id={id} text={terms.entries[id].term} labels={terms} />
            </li>
          ))}
        </ul>
      </Fragment>
      {render({ station, labels, sampling, step, earlierSteps, selection, select })}
    </section>
  );
}
