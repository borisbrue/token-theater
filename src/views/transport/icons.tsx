const SVG_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const PATHS = {
  toStart: ['M6 5v14', 'M18 6l-9 6 9 6z'],
  stepBack: ['M11 6l-6 6 6 6', 'M19 6l-6 6 6 6'],
  stationBack: ['M15 6l-6 6 6 6'],
  stationForward: ['M9 6l6 6-6 6'],
  stepForward: ['M5 6l6 6-6 6', 'M13 6l6 6-6 6'],
  toEnd: ['M6 6l9 6-9 6z', 'M18 5v14'],
  play: ['M8 5l11 7-11 7z'],
  pause: ['M9 5v14', 'M15 5v14'],
} as const;

export type IconName = keyof typeof PATHS;

/** Dekoratives Strich-Icon; der Knopf trägt den Namen per aria-label. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg {...SVG_PROPS} aria-hidden={true} focusable={false}>
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
