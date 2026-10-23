import type { StationKind } from '../../trace/types';

/** Stationen, die nur eine Engine mit Interna liefert (SPEC-0009 §3.5). */
export const INTERNAL_KINDS: readonly StationKind[] = ['embed', 'attention', 'mlp', 'residual'];

/** Fehlt dem Trace eine der internen Stationen (z. B. ein Server-Lauf)? */
export function lacksInternals(capabilities: readonly StationKind[]): boolean {
  return INTERNAL_KINDS.some((kind) => !capabilities.includes(kind));
}
