import { FEED_FORWARD_KINDS, type StationKind } from '../../trace/types';

/** Stationen, die eine Engine mit Interna immer liefert (SPEC-0009 §3.5, SPEC-0011 §3.5). */
export const INTERNAL_KINDS: readonly StationKind[] = ['attention', 'residual'];

/**
 * Fehlen dem Trace die Interna (z. B. ein Server-Lauf)? Ja, wenn attention oder residual fehlt
 * oder es keinen Feed-Forward-Teil gibt (weder mlp noch moe). embed ist nicht nötig: exportierte
 * RoPE-Modelle haben keine embed-Station.
 */
export function lacksInternals(capabilities: readonly StationKind[]): boolean {
  return (
    INTERNAL_KINDS.some((kind) => !capabilities.includes(kind)) ||
    !FEED_FORWARD_KINDS.some((kind) => capabilities.includes(kind))
  );
}
