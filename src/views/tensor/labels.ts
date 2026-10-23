import type { ScaleStop } from './color-scale';

/** Farbskalen der Ansichten, vom Theme über den Player (SPEC-0007 §3.1, Strategy). */
export interface ViewScales {
  sequential: readonly ScaleStop[];
  diverging: readonly ScaleStop[];
}

/** Texte, die alle Tensor-Ansichten teilen (SPEC-0007 §3.6/3.7). */
export interface TensorViewLabels {
  position: string;
  positionOption: (position: number, token: string) => string;
  strip: (title: string, count: number) => string;
  dimension: (index: number, value: string) => string;
  scale: (limit: string) => string;
  vectors: string;
  norm: (title: string, norm: string) => string;
}
