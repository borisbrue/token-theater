export interface StationStripProps {
  stations: readonly { short: string; name: string }[];
  current: number;
  onSeek: (station: number) => void;
  labels: { stations: string };
}

/** Stationsleiste des aktuellen Schritts (SPEC-0002 FR-09). */
export function StationStrip({ stations, current, onSeek, labels }: StationStripProps) {
  return (
    <div className="station-strip" role="group" aria-label={labels.stations}>
      {stations.map((station, i) => (
        <button
          key={i}
          type="button"
          className="station-button"
          aria-label={station.name}
          aria-current={i === current ? 'step' : undefined}
          onClick={() => onSeek(i)}
        >
          {station.short}
        </button>
      ))}
    </div>
  );
}
