import type { PlaybackCommand, Speed } from '../../playback/types';
import { SPEEDS } from '../../playback/types';
import { Icon, type IconName } from './icons';

export interface TransportLabels {
  toStart: string;
  stepBack: string;
  stationBack: string;
  play: string;
  pause: string;
  stationForward: string;
  stepForward: string;
  toEnd: string;
  tempo: string;
  speed: (speed: number) => string;
  shortcuts: string;
}

export interface TransportBarProps {
  playing: boolean;
  speed: Speed;
  canBack: boolean;
  canForward: boolean;
  canStepBack: boolean;
  canStepForward: boolean;
  onCommand: (command: PlaybackCommand) => void;
  labels: TransportLabels;
}

interface ButtonSpec {
  icon: IconName;
  label: string;
  command: PlaybackCommand;
  enabled: boolean;
}

/** Transportknöpfe und Tempo (SPEC-0002 FR-09). */
export function TransportBar({
  playing,
  speed,
  canBack,
  canForward,
  canStepBack,
  canStepForward,
  onCommand,
  labels,
}: TransportBarProps) {
  const before: ButtonSpec[] = [
    { icon: 'toStart', label: labels.toStart, command: { type: 'first' }, enabled: canBack },
    {
      icon: 'stepBack',
      label: labels.stepBack,
      command: { type: 'prevStep' },
      enabled: canStepBack,
    },
    { icon: 'stationBack', label: labels.stationBack, command: { type: 'prev' }, enabled: canBack },
  ];
  const after: ButtonSpec[] = [
    {
      icon: 'stationForward',
      label: labels.stationForward,
      command: { type: 'next' },
      enabled: canForward,
    },
    {
      icon: 'stepForward',
      label: labels.stepForward,
      command: { type: 'nextStep' },
      enabled: canStepForward,
    },
    { icon: 'toEnd', label: labels.toEnd, command: { type: 'last' }, enabled: canForward },
  ];
  const renderButton = (spec: ButtonSpec) => (
    <button
      key={spec.label}
      type="button"
      className="icon-button"
      aria-label={spec.label}
      disabled={!spec.enabled}
      onClick={() => onCommand(spec.command)}
    >
      <Icon name={spec.icon} />
    </button>
  );
  return (
    <div className="transport-row">
      <div className="transport-buttons">
        {before.map(renderButton)}
        <button
          type="button"
          className="play-button"
          aria-label={playing ? labels.pause : labels.play}
          onClick={() => onCommand({ type: 'toggle' })}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        {after.map(renderButton)}
      </div>
      <div className="tempo" role="group" aria-label={labels.tempo}>
        <span className="label" aria-hidden={true}>
          {labels.tempo}
        </span>
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            className="tempo-button"
            aria-pressed={value === speed}
            onClick={() => onCommand({ type: 'setSpeed', speed: value })}
          >
            {labels.speed(value)}
          </button>
        ))}
      </div>
      <p className="shortcuts">{labels.shortcuts}</p>
    </div>
  );
}
