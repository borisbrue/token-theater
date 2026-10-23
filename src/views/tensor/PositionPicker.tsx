import type { GenerationStep } from '../../trace/types';
import { displayText } from '../tokenization/token-display';
import { RadioChoice } from './RadioChoice';

export interface PositionPickerProps {
  step: GenerationStep;
  /** Gewählte Zeile der Station (0 … e − 1). */
  row: number;
  onSelect: (position: number) => void;
  labels: { position: string; positionOption: (position: number, token: string) => string };
}

/** Wahl einer Zeile der Station als absolute Position (SPEC-0007 §3.6). */
export function PositionPicker({ step, row, onSelect, labels }: PositionPickerProps) {
  const [a, b] = step.newPositions;
  const options = Array.from({ length: b - a }, (_, i) => ({
    value: a + i,
    label: labels.positionOption(a + i, displayText(step.contextTokens[a + i]?.text ?? '')),
  }));
  return (
    <RadioChoice label={labels.position} options={options} value={a + row} onChange={onSelect} />
  );
}
