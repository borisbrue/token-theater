import type { Glossary, TermId } from './types';

export interface GlossaryViewLabels {
  region: string;
  heading: string;
  intro: string;
  inApp: string;
  entries: Glossary;
}

/** Ansicht „Glossar“ (SPEC-0010 §3.8): alle Begriffe alphabetisch. */
export function GlossaryView({ labels }: { labels: GlossaryViewLabels }) {
  const ids = (Object.keys(labels.entries) as TermId[]).sort((a, b) =>
    labels.entries[a].term.localeCompare(labels.entries[b].term, 'de'),
  );
  return (
    <section className="glossary panel" aria-label={labels.region}>
      <h2>{labels.heading}</h2>
      <p className="explanation">{labels.intro}</p>
      <dl className="glossary-list">
        {ids.map((id) => {
          const entry = labels.entries[id];
          return (
            <div key={id} className="glossary-entry">
              <dt id={`begriff-${id}`}>{entry.term}</dt>
              <dd>
                <p>{entry.meaning}</p>
                <p className="term-in-app">{`${labels.inApp}${entry.inApp}`}</p>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
