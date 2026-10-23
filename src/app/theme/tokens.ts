/**
 * Aurora-Farbtokens (ADR-0001, CON-0007 T-01). Gleiche Werte wie in tokens.css; hier für
 * Rechnungen (Kontrast, Datenskala) und Tests. Schlüssel ohne `--tt-`.
 */
export const COLORS = {
  bg: '#070b14',
  surface: '#0d1424',
  'surface-2': '#121c31',
  line: '#1f2b45',
  'line-strong': '#2a3a5e',
  text: '#e6f1ff',
  'text-soft': '#d4e2f7',
  'text-muted': '#8ea3c4',
  mint: '#34f5a4',
  cyan: '#2ee6e6',
  blue: '#4c7dff',
  'blue-deep': '#1b3a8a',
  violet: '#8b5cf6',
  error: '#ff5c8a',
  'on-accent': '#04131a',
} as const;

export type ColorToken = keyof typeof COLORS;

export interface ScaleStop {
  at: number;
  color: string;
}

/** Sequentielle Datenskala: dunkel = 0, Mint = 1 (Heatmaps, Wahrscheinlichkeiten). */
export const DATA_SCALE: readonly ScaleStop[] = [
  { at: 0, color: COLORS.surface },
  { at: 0.35, color: COLORS['blue-deep'] },
  { at: 0.72, color: COLORS.cyan },
  { at: 1, color: COLORS.mint },
];

/** Divergierende Datenskala um 0: violet = negativ, surface-2 = 0, mint = positiv (SPEC-0007). */
export const DIVERGING_SCALE: readonly ScaleStop[] = [
  { at: 0, color: COLORS.violet },
  { at: 0.5, color: COLORS['surface-2'] },
  { at: 1, color: COLORS.mint },
];
