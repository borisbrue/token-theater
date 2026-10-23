import { useEffect, useRef, useState } from 'react';

import { formatDecimal } from '../distribution/format';
import { cellUnder, paintCells } from './canvas';
import { divergingPosition, type ScaleStop } from './color-scale';

export interface VectorStripProps {
  title: string;
  values: Float32Array;
  /** Gemeinsame Grenze aller Streifen einer Ansicht. */
  limit: number;
  scale: readonly ScaleStop[];
  labels: {
    strip: (title: string, count: number) => string;
    dimension: (i: number, value: string) => string;
  };
}

/** Ein Vektor als Farbstreifen, ein Pixel je Wert (SPEC-0007 §3.6). */
export function VectorStrip({ title, values, limit, scale, labels }: VectorStripProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => {
    if (canvas.current === null) return;
    paintCells(canvas.current, 1, values.length, scale, (_, col) => ({
      t: divergingPosition(values[col] ?? 0, limit),
    }));
  }, [values, limit, scale]);
  const value = hovered === null ? undefined : values[hovered];
  return (
    <figure className="vector-strip">
      <figcaption>{title}</figcaption>
      <canvas
        ref={canvas}
        role="img"
        aria-label={labels.strip(title, values.length)}
        data-swipe="ignore"
        onPointerDown={(event) => setHovered(cellUnder(event, 1, values.length)?.col ?? null)}
        onPointerMove={(event) => setHovered(cellUnder(event, 1, values.length)?.col ?? null)}
        onPointerLeave={(event) => {
          // Nach einem Tipp bleibt der Wert stehen (SPEC-0013 §3.3).
          if (event.pointerType === 'mouse') setHovered(null);
        }}
      />
      <p className="readout">
        {hovered !== null &&
          value !== undefined &&
          labels.dimension(hovered, formatDecimal(value, 2))}
      </p>
    </figure>
  );
}
