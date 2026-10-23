/**
 * Tasten am Begriff-Knopf (SPEC-0010 §3.7, Command): nur `Escape` bei offener Erklärung; Enter und
 * Leertaste sind das native Klicken des Knopfs.
 */
export function termCommandForKey(key: string, open: boolean): 'close' | null {
  return key === 'Escape' && open ? 'close' : null;
}
