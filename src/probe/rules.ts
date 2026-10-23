import type { Probe, ProbeIssue, ProbeReport, ReportPair } from './types';

/** Regeln von Sonde und Bericht, die JSON Schema nicht ausdrücken kann (CON-0024). */

const tol = (x: number): number => 1e-4 * Math.max(1, Math.abs(x));

const issue = (rule: string, path: string, message: string): ProbeIssue => ({
  path,
  message,
  rule,
});

/** Befund am zweiten Vorkommen jeder doppelten ID (PB-01, RP-01). */
function duplicateIds(ids: readonly string[], rule: string): ProbeIssue[] {
  const seen = new Set<string>();
  const found: ProbeIssue[] = [];
  ids.forEach((id, i) => {
    if (seen.has(id)) found.push(issue(rule, `/pairs/${i}/id`, `Paar-ID ${id} kommt doppelt vor`));
    seen.add(id);
  });
  return found;
}

export function checkProbe(probe: Probe): ProbeIssue[] {
  const found = duplicateIds(
    probe.pairs.map((pair) => pair.id),
    'PB-01',
  );
  probe.pairs.forEach((pair, i) => {
    const seen = new Set<string>();
    pair.targets.forEach((target, j) => {
      if (seen.has(target)) {
        found.push(issue('PB-02', `/pairs/${i}/targets/${j}`, `Ziel „${target}“ doppelt`));
      }
      seen.add(target);
    });
  });
  return found;
}

/** RP-02: logRatio genau bei zwei Zielen, und dann ln(p₀/p₁), wenn beide p > 0. */
function checkLogRatio(pair: ReportPair, i: number): ProbeIssue[] {
  const found: ProbeIssue[] = [];
  const two = pair.targets.length === 2;
  for (const side of ['A', 'B'] as const) {
    const field = side === 'A' ? 'logRatioA' : 'logRatioB';
    const value = pair[field];
    const path = `/pairs/${i}/${field}`;
    if (!two) {
      if (value !== null) found.push(issue('RP-02', path, 'nur bei genau zwei Zielen eine Zahl'));
      continue;
    }
    if (value === null) {
      found.push(issue('RP-02', path, 'bei zwei Zielen ist eine Zahl nötig'));
      continue;
    }
    const [p0, p1] = pair.targets.map((t) => (side === 'A' ? t.pA : t.pB));
    if (p0 === undefined || p1 === undefined || p0 <= 0 || p1 <= 0) continue;
    const expected = Math.log(p0 / p1);
    if (Math.abs(value - expected) > tol(value)) {
      found.push(issue('RP-02', path, `erwartet ln(p₀/p₁) = ${expected}`));
    }
  }
  return found;
}

/** RP-03: flip aus den Vorzeichen; null genau ohne logRatio. */
function checkFlip(pair: ReportPair, i: number): ProbeIssue[] {
  const path = `/pairs/${i}/flip`;
  const { logRatioA: a, logRatioB: b } = pair;
  if (a === null) {
    return pair.flip === null ? [] : [issue('RP-03', path, 'ohne logRatio ist flip null')];
  }
  if (b === null) return [];
  const expected = (a > 0 && b < 0) || (a < 0 && b > 0);
  return pair.flip === expected ? [] : [issue('RP-03', path, `erwartet ${String(expected)}`)];
}

/** Verschiebungen |logRatioB − logRatioA| der Paare mit Zahlen. */
export function shifts(pairs: readonly ReportPair[]): number[] {
  return pairs.flatMap((pair) =>
    pair.logRatioA === null || pair.logRatioB === null
      ? []
      : [Math.abs(pair.logRatioB - pair.logRatioA)],
  );
}

function checkSummary(report: ProbeReport): ProbeIssue[] {
  const found: ProbeIssue[] = [];
  const { summary, pairs } = report;
  if (summary.pairs !== pairs.length) {
    found.push(issue('RP-04', '/summary/pairs', `erwartet ${pairs.length}`));
  }
  const flips = pairs.filter((pair) => pair.flip === true).length;
  if (summary.flips !== flips) found.push(issue('RP-04', '/summary/flips', `erwartet ${flips}`));
  const values = shifts(pairs);
  const mean = values.length === 0 ? null : values.reduce((x, y) => x + y, 0) / values.length;
  const actual = summary.meanAbsLogRatioShift;
  const wrong =
    mean === null || actual === null ? mean !== actual : Math.abs(actual - mean) > tol(mean);
  if (wrong) {
    found.push(
      issue('RP-04', '/summary/meanAbsLogRatioShift', `erwartet ${mean === null ? 'null' : mean}`),
    );
  }
  return found;
}

/** RP-05: Ranglisten absteigend, Befund am ersten größeren Eintrag. */
function checkRanking(pair: ReportPair, i: number): ProbeIssue[] {
  const found: ProbeIssue[] = [];
  for (const field of ['topA', 'topB'] as const) {
    const list = pair[field];
    const j = list.findIndex((entry, k) => k > 0 && entry.prob > (list[k - 1]?.prob ?? 0));
    if (j > 0) found.push(issue('RP-05', `/pairs/${i}/${field}/${j}`, 'nicht absteigend'));
  }
  return found;
}

export function checkReport(report: ProbeReport): ProbeIssue[] {
  const found = duplicateIds(
    report.pairs.map((pair) => pair.id),
    'RP-01',
  );
  report.pairs.forEach((pair, i) => {
    found.push(...checkLogRatio(pair, i), ...checkFlip(pair, i), ...checkRanking(pair, i));
  });
  return [...found, ...checkSummary(report)];
}
