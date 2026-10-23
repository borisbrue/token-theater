import { channels, sampleScale, type ScaleStop } from './color-scale';

/**
 * Zeichnet Zellen auf eine Canvas mit einem Pixel je Zelle (CSS streckt sie, SPEC-0007 §3.6).
 * Durchsichtige Zellen zeigen den Hintergrund des Elements (maskiert, gedämpft).
 */

export interface Cell {
  /** Stelle auf der Skala, 0 … 1; null = maskiert (durchsichtig). */
  t: number | null;
  /** Deckkraft 0 … 1 (gedämpfte Zeilen). */
  alpha?: number;
}

export function paintCells(
  canvas: HTMLCanvasElement,
  rows: number,
  cols: number,
  scale: readonly ScaleStop[],
  cellAt: (row: number, col: number) => Cell,
): void {
  canvas.width = Math.max(1, cols);
  canvas.height = Math.max(1, rows);
  const context = canvas.getContext('2d');
  if (context === null) return;
  const image = context.createImageData(canvas.width, canvas.height);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const { t, alpha = 1 } = cellAt(r, c);
      const offset = (r * canvas.width + c) * 4;
      if (t === null) continue;
      const [red, green, blue] = channels(sampleScale(scale, t));
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
}

/** Zelle unter dem Mauszeiger; null außerhalb. */
export function cellUnder(
  event: { clientX: number; clientY: number; currentTarget: Element },
  rows: number,
  cols: number,
): { row: number; col: number } | null {
  const box = event.currentTarget.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const col = Math.floor(((event.clientX - box.left) / box.width) * cols);
  const row = Math.floor(((event.clientY - box.top) / box.height) * rows);
  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  return { row, col };
}
