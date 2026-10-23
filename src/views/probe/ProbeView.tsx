import { useState, type ChangeEvent } from 'react';

import type { ProbeReport, ReportPair } from '../../probe/types';
import { formatPercent, formatSigned } from '../distribution/format';
import { Term } from '../glossary/Term';
import { TermText } from '../glossary/TermText';
import type { TermId, TermLabels } from '../glossary/types';
import { RadioChoice } from '../tensor/RadioChoice';
import { displayText } from '../tokenization/token-display';

export interface ProbeLabels {
  region: string;
  heading: string;
  intro: string;
  importLabel: string;
  empty: string;
  head: (probe: string, model: string) => string;
  hint: string;
  summary: string;
  pairCount: (count: number) => string;
  flipCount: (count: number) => string;
  meanShift: (value: string) => string;
  sorting: string;
  byProbe: string;
  byShift: string;
  pairs: string;
  pair: string;
  promptA: string;
  promptB: string;
  targets: string;
  logRatio: string;
  js: string;
  target: (text: string, pA: string, pB: string) => string;
  ratio: (a: string, b: string) => string;
  flip: string;
  missing: string;
}

export interface ProbeTerms extends TermLabels {
  termList: string;
  ids: readonly TermId[];
}

export interface ProbeError {
  message: string;
  details: readonly string[];
}

export interface ProbeViewProps {
  report: ProbeReport | null;
  onImport: (file: File) => void;
  error: ProbeError | null;
  labels: ProbeLabels;
  terms: ProbeTerms;
}

type Sorting = 'probe' | 'shift';

/** Werte des Attributs scope, keine sichtbaren Texte. */
const COLUMN = 'col';
const ROW = 'row';

const shiftOf = (pair: ReportPair): number | null =>
  pair.logRatioA === null || pair.logRatioB === null
    ? null
    : Math.abs(pair.logRatioB - pair.logRatioA);

/** Größte Verschiebung zuerst, Paare ohne logRatio zuletzt, sonst Reihenfolge der Sonde. */
function sortedPairs(pairs: readonly ReportPair[], sorting: Sorting): ReportPair[] {
  if (sorting === 'probe') return [...pairs];
  return pairs
    .map((pair, index) => ({ pair, index, shift: shiftOf(pair) }))
    .sort((x, y) => {
      if (x.shift === null || y.shift === null) {
        if (x.shift === y.shift) return x.index - y.index;
        return x.shift === null ? 1 : -1;
      }
      return y.shift - x.shift || x.index - y.index;
    })
    .map((entry) => entry.pair);
}

function ratioText(pair: ReportPair, labels: ProbeLabels): string {
  if (pair.logRatioA === null || pair.logRatioB === null) return labels.missing;
  const text = labels.ratio(formatSigned(pair.logRatioA, 2), formatSigned(pair.logRatioB, 2));
  return pair.flip === true ? `${text}${labels.flip}` : text;
}

function Report({ report, labels }: { report: ProbeReport; labels: ProbeLabels }) {
  const [sorting, setSorting] = useState<Sorting>('probe');
  const { summary } = report;
  const options = [
    { value: 'probe' as const, label: labels.byProbe },
    { value: 'shift' as const, label: labels.byShift },
  ];
  return (
    <>
      <p className="probe-head">{labels.head(report.probe, report.model)}</p>
      <p role="note" className="hint probe-hint">
        {labels.hint}
      </p>
      <ul className="probe-summary" aria-label={labels.summary}>
        <li>{labels.pairCount(summary.pairs)}</li>
        <li>{labels.flipCount(summary.flips)}</li>
        {summary.meanAbsLogRatioShift !== null && (
          <li>{labels.meanShift(formatSigned(summary.meanAbsLogRatioShift, 2))}</li>
        )}
      </ul>
      <RadioChoice label={labels.sorting} options={options} value={sorting} onChange={setSorting} />
      <div className="compare-scroll" data-swipe="ignore">
        <table className="compare-table probe-table">
          <caption>{labels.pairs}</caption>
          <thead>
            <tr>
              <th scope={COLUMN}>{labels.pair}</th>
              <th scope={COLUMN}>{labels.promptA}</th>
              <th scope={COLUMN}>{labels.promptB}</th>
              <th scope={COLUMN}>{labels.targets}</th>
              <th scope={COLUMN}>{labels.logRatio}</th>
              <th scope={COLUMN}>{labels.js}</th>
            </tr>
          </thead>
          <tbody>
            {sortedPairs(report.pairs, sorting).map((pair) => (
              <tr key={pair.id} className={pair.flip === true ? 'flip' : undefined}>
                <th scope={ROW}>{pair.id}</th>
                <td>{pair.a}</td>
                <td>{pair.b}</td>
                <td>
                  <ul className="probe-targets">
                    {pair.targets.map((target) => (
                      <li key={target.text}>
                        <span>
                          {labels.target(
                            displayText(target.text),
                            formatPercent(target.pA),
                            formatPercent(target.pB),
                          )}
                        </span>
                        <span className="probe-bars" aria-hidden={true}>
                          <span className="probe-bar-a" style={{ width: `${target.pA * 100}%` }} />
                          <span className="probe-bar-b" style={{ width: `${target.pB * 100}%` }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{ratioText(pair, labels)}</td>
                <td>{formatSigned(pair.js, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Ansicht „Sonde“ (SPEC-0012 FR-06): der Bericht des Python-Werkzeugs als Tabelle. */
export function ProbeView({ report, onImport, error, labels, terms }: ProbeViewProps) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file !== undefined) onImport(file);
  };
  return (
    <section className="probe panel" aria-label={labels.region}>
      <h2>{labels.heading}</h2>
      <p className="explanation">
        <TermText text={labels.intro} labels={terms} />
      </p>
      <div className="file-row">
        <label htmlFor="probe-import" className="file-label">
          {labels.importLabel}
        </label>
        <input id="probe-import" type="file" accept=".json,application/json" onChange={onChange} />
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
      {report === null ? (
        <p role="note" className="hint">
          {labels.empty}
        </p>
      ) : (
        <Report key={`${report.probe}/${report.createdAt}`} report={report} labels={labels} />
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
