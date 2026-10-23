import { useEffect, useRef, useState } from 'react';

import { formatPercent } from '../distribution/format';
import type { AttentionMatrix } from './attention-matrix';
import { cellUnder, paintCells } from './canvas';
import type { ScaleStop } from './color-scale';

const DIMMED = 0.45;

export interface HeatmapLabels {
  cell: (row: string, col: string, value: string) => string;
  masked: (row: string, col: string) => string;
}

export interface HeatmapProps {
  matrix: AttentionMatrix;
  /** Sichtbar gemachte Tokens je Position 0 … cols − 1. */
  tokens: readonly string[];
  name: string;
  scale: readonly ScaleStop[];
  labels: HeatmapLabels;
}

/**
 * Attention-Matrix als Heatmap, feste Skala 0 bis 100 % (SPEC-0007 §3.6). Die Canvas umfasst
 * genau die Felder; Beschriftungen liegen außerhalb.
 */
export function Heatmap({ matrix, tokens, name, scale, labels }: HeatmapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);
  const { rows, cols, values, current } = matrix;
  useEffect(() => {
    if (canvas.current === null) return;
    paintCells(canvas.current, rows.length, cols, scale, (r, c) =>
      c > (rows[r] ?? 0)
        ? { t: null }
        : { t: values[r * cols + c] ?? 0, alpha: r >= current[0] && r < current[1] ? 1 : DIMMED },
    );
  }, [rows, cols, values, current, scale]);

  let readout = '';
  if (hovered !== null) {
    const position = rows[hovered.row] ?? 0;
    const row = tokens[position] ?? '';
    const col = tokens[hovered.col] ?? '';
    readout =
      hovered.col > position
        ? labels.masked(row, col)
        : labels.cell(row, col, formatPercent(values[hovered.row * cols + hovered.col] ?? 0));
  }
  return (
    <figure
      className="heatmap"
      style={{ '--cols': cols, '--rows': rows.length } as React.CSSProperties}
    >
      <div className="heatmap-cols" aria-hidden={true}>
        {Array.from({ length: cols }, (_, c) => (
          <span key={c}>{tokens[c]}</span>
        ))}
      </div>
      <div className="heatmap-rows" aria-hidden={true}>
        {rows.map((position, r) => (
          <span
            key={position}
            className={r >= current[0] && r < current[1] ? 'current' : undefined}
          >
            {tokens[position]}
          </span>
        ))}
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label={name}
        data-swipe="ignore"
        onPointerDown={(event) => setHovered(cellUnder(event, rows.length, cols))}
        onPointerMove={(event) => setHovered(cellUnder(event, rows.length, cols))}
        onPointerLeave={(event) => {
          // Nach einem Tipp bleibt der Wert stehen (SPEC-0013 §3.3).
          if (event.pointerType === 'mouse') setHovered(null);
        }}
      />
      <p className="readout">{readout}</p>
    </figure>
  );
}
