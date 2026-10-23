/** Sonde und Sonden-Bericht (SPEC-0012 §3.4, CON-0024). Reine Daten, ohne React. */

export interface ProbePair {
  id: string;
  attribute: string;
  a: string;
  b: string;
  targets: string[];
}

export interface Probe {
  schemaVersion: 1;
  kind: 'probe';
  name: string;
  language: string;
  description: string;
  pairs: ProbePair[];
}

export interface ReportTarget {
  text: string;
  id: number;
  pA: number;
  pB: number;
}

export interface RankedToken {
  id: number;
  text: string;
  prob: number;
}

export interface ReportPair {
  id: string;
  attribute: string;
  a: string;
  b: string;
  targets: ReportTarget[];
  /** ln(p(Ziel 0) / p(Ziel 1)); nur bei genau zwei Zielen. */
  logRatioA: number | null;
  logRatioB: number | null;
  /** logRatioA und logRatioB haben echt verschiedene Vorzeichen. */
  flip: boolean | null;
  /** Jensen-Shannon-Divergenz über das ganze Vokabular, Basis 2. */
  js: number;
  topA: RankedToken[];
  topB: RankedToken[];
}

export interface ReportSummary {
  pairs: number;
  flips: number;
  meanAbsLogRatioShift: number | null;
}

export interface ProbeReport {
  schemaVersion: 1;
  kind: 'probe-report';
  probe: string;
  model: string;
  generator: string;
  createdAt: string;
  pairs: ReportPair[];
  summary: ReportSummary;
}

/** Befund beim Import; `rule` nur bei semantischen Befunden (PB-xx, RP-xx). */
export interface ProbeIssue {
  path: string;
  message: string;
  rule?: string;
}
