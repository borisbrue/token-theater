export interface StepTimelineProps {
  steps: readonly { index: number; label: string }[];
  current: number;
  onSeek: (step: number) => void;
  labels: { timeline: string };
}

/** Zeitleiste der Schritte (SPEC-0002 FR-09). */
export function StepTimeline({ steps, current, onSeek, labels }: StepTimelineProps) {
  return (
    <div className="timeline" role="group" aria-label={labels.timeline}>
      {steps.map((step) => (
        <button
          key={step.index}
          type="button"
          className="timeline-step"
          aria-current={step.index === current ? 'step' : undefined}
          onClick={() => onSeek(step.index)}
        >
          {step.label}
        </button>
      ))}
    </div>
  );
}
