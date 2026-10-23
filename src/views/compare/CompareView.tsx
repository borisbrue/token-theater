import type { ChangeEvent } from 'react';

import type { GenerationStep, Trace } from '../../trace/types';
import { formatPercent, formatSigned } from '../distribution/format';
import { Term } from '../glossary/Term';
import { TermText } from '../glossary/TermText';
import type { TermId, TermLabels } from '../glossary/types';
import { RadioChoice } from '../tensor/RadioChoice';
import { displayText } from '../tokenization/token-display';
import { comparability, largestDrop, layerDiff, outputDiff, type LayerRow } from './diff';

export interface CompareLabels {
  region: string;
  heading: string;
  intro: string;
  importLabel: string;
  runs: string;
  run: (side: string, model: string, prompt: string) => string;
  noA: string;
  noB: string;
  none: string;
  otherModels: string;
  noInternals: string;
  step: string;
  stepOption: (index: number) => string;
  chosen: (a: string, b: string) => string;
  output: string;
  token: string;
  pA: string;
  pB: string;
  delta: string;
  js: (value: string) => string;
  layers: string;
  layer: string;
  cosine: string;
  lensA: string;
  lensB: string;
  experts: string;
  layerHead: (layer: number) => string;
  expertShare: (shared: number, total: number) => string;
  missing: string;
  layerHint: string;
  drop: (layer: number) => string;
}

export interface CompareTerms extends TermLabels {
  termList: string;
  ids: readonly TermId[];
}

export interface CompareError {
  message: string;
  details: readonly string[];
}

export interface CompareViewProps {
  a: Trace | null;
  b: Trace | null;
  step: number;
  onStep: (step: number) => void;
  onImport: (file: File) => void;
  error: CompareError | null;
  labels: CompareLabels;
  terms: CompareTerms;
}

/** Werte des Attributs scope, keine sichtbaren Texte. */
const COLUMN = 'col';
const ROW = 'row';
const SIDE_A = 'A';
const SIDE_B = 'B';

function OutputTable({
  a,
  b,
  labels,
  terms,
}: {
  a: GenerationStep;
  b: GenerationStep;
  labels: CompareLabels;
  terms: TermLabels;
}) {
  const diff = outputDiff(a, b);
  if (diff === null) return null;
  return (
    <>
      <div className="compare-scroll" data-swipe="ignore">
        <table className="compare-table compare-output">
          <caption>{labels.output}</caption>
          <thead>
            <tr>
              <th scope={COLUMN}>{labels.token}</th>
              <th scope={COLUMN}>{labels.pA}</th>
              <th scope={COLUMN}>{labels.pB}</th>
              <th scope={COLUMN}>{labels.delta}</th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((row) => {
              const classes = [
                row.token.id === a.chosen.id ? 'chosen-a' : '',
                row.token.id === b.chosen.id ? 'chosen-b' : '',
              ].filter((name) => name !== '');
              return (
                <tr
                  key={row.token.id}
                  className={classes.length === 0 ? undefined : classes.join(' ')}
                >
                  <th scope={ROW}>{displayText(row.token.text)}</th>
                  <td>{formatPercent(row.pA)}</td>
                  <td>{formatPercent(row.pB)}</td>
                  <td className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : undefined}>
                    {formatSigned(row.delta * 100, 1, true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="compare-js">
        <TermText text={labels.js(formatSigned(diff.js, 3))} labels={terms} />
      </p>
    </>
  );
}

function LayerTable({
  rows,
  topK,
  labels,
  terms,
}: {
  rows: readonly LayerRow[];
  /** Experten je Token aus der Architektur von A. */
  topK: number;
  labels: CompareLabels;
  terms: TermLabels;
}) {
  const drop = largestDrop(rows);
  const withExperts = rows.some((row) => row.expertOverlap !== null);
  const lens = (token: LayerRow['lensA']): string =>
    token === null ? labels.missing : displayText(token.text);
  return (
    <>
      <div className="compare-scroll" data-swipe="ignore">
        <table className="compare-table compare-layers">
          <caption>{labels.layers}</caption>
          <thead>
            <tr>
              <th scope={COLUMN}>{labels.layer}</th>
              <th scope={COLUMN}>{labels.cosine}</th>
              <th scope={COLUMN}>{labels.lensA}</th>
              <th scope={COLUMN}>{labels.lensB}</th>
              {withExperts && <th scope={COLUMN}>{labels.experts}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.layer} className={row.layer === drop ? 'largest-drop' : undefined}>
                <th scope={ROW}>{labels.layerHead(row.layer)}</th>
                <td>
                  <span className="compare-cosine">{formatSigned(row.cosine, 3)}</span>
                  <span className="compare-bar" aria-hidden={true}>
                    <span style={{ width: `${Math.max(0, row.cosine) * 100}%` }} />
                  </span>
                </td>
                <td>{lens(row.lensA)}</td>
                <td>{lens(row.lensB)}</td>
                {withExperts && (
                  <td>
                    {row.expertOverlap === null
                      ? labels.missing
                      : labels.expertShare(Math.round(row.expertOverlap * topK), topK)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        <TermText text={labels.layerHint} labels={terms} />
      </p>
      {drop !== null && <p className="compare-drop">{labels.drop(drop)}</p>}
    </>
  );
}

/** Hinweis zur Vergleichbarkeit; null bei vollem Vergleich. */
function comparabilityNote(a: Trace, b: Trace, labels: CompareLabels): string | null {
  switch (comparability(a, b)) {
    case 'none':
      return labels.none;
    case 'output':
      return a.engine.model === b.engine.model ? labels.noInternals : labels.otherModels;
    case 'full':
      return null;
  }
}

function Comparison({
  a,
  b,
  step,
  onStep,
  labels,
  terms,
}: {
  a: Trace;
  b: Trace;
  step: number;
  onStep: (step: number) => void;
  labels: CompareLabels;
  terms: TermLabels;
}) {
  const kind = comparability(a, b);
  const note = comparabilityNote(a, b, labels);
  if (kind === 'none') {
    return (
      <p role="note" className="hint">
        {note}
      </p>
    );
  }
  const count = Math.min(a.steps.length, b.steps.length);
  const index = Math.min(step, count - 1);
  const stepA = a.steps[index];
  const stepB = b.steps[index];
  const options = Array.from({ length: count }, (_, i) => ({
    value: i,
    label: labels.stepOption(i),
  }));
  return (
    <>
      {note !== null && (
        <p role="note" className="hint">
          {note}
        </p>
      )}
      <RadioChoice label={labels.step} options={options} value={index} onChange={onStep} />
      {stepA !== undefined && stepB !== undefined && (
        <>
          <p className="compare-chosen">
            {labels.chosen(displayText(stepA.chosen.text), displayText(stepB.chosen.text))}
          </p>
          <OutputTable a={stepA} b={stepB} labels={labels} terms={terms} />
          {kind === 'full' && (
            <LayerTable
              rows={layerDiff(stepA, stepB)}
              topK={a.engine.architecture?.topK ?? 1}
              labels={labels}
              terms={terms}
            />
          )}
        </>
      )}
    </>
  );
}

/**
 * Ansicht „Vergleich“ (SPEC-0012 FR-01–FR-03): Lauf A ist der aktuelle Trace, Lauf B der
 * Vergleichstrace. Rechnet nur aus beiden Traces und ändert sie nicht.
 */
export function CompareView({
  a,
  b,
  step,
  onStep,
  onImport,
  error,
  labels,
  terms,
}: CompareViewProps) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file !== undefined) onImport(file);
  };
  const runs = [
    { side: SIDE_A, trace: a },
    { side: SIDE_B, trace: b },
  ].filter((run) => run.trace !== null);
  return (
    <section className="compare panel" aria-label={labels.region}>
      <h2>{labels.heading}</h2>
      <p className="explanation">
        <TermText text={labels.intro} labels={terms} />
      </p>
      <div className="file-row">
        <label htmlFor="compare-import" className="file-label">
          {labels.importLabel}
        </label>
        <input
          id="compare-import"
          type="file"
          accept=".json,application/json"
          onChange={onChange}
        />
      </div>
      {error !== null && (
        <div role="alert" className="error">
          <p>{error.message}</p>
          {error.details.length > 0 && (
            <ul>
              {error.details.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {runs.length > 0 && (
        <ul className="compare-runs" aria-label={labels.runs}>
          {runs.map((run) => (
            <li key={run.side}>
              {labels.run(run.side, run.trace?.engine.model ?? '', run.trace?.prompt ?? '')}
            </li>
          ))}
        </ul>
      )}
      {a === null ? (
        <p role="note" className="hint">
          {labels.noA}
        </p>
      ) : b === null ? (
        <p role="note" className="hint">
          {labels.noB}
        </p>
      ) : (
        <Comparison a={a} b={b} step={step} onStep={onStep} labels={labels} terms={terms} />
      )}
      <ul className="term-list" aria-label={terms.termList}>
        {terms.ids.map((id) => (
          <li key={id}>
            <Term id={id} text={terms.entries[id].term} labels={terms} />
          </li>
        ))}
      </ul>
    </section>
  );
}
