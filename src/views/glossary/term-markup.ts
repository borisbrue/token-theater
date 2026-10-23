/** Ein Stück Text: reiner Text oder ein markierter Begriff (SPEC-0010 §3.6). */
export type TermSegment =
  | { kind: 'text'; text: string }
  | { kind: 'term'; id: string; text: string };

const MARK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/**
 * Zerlegt `[[id|Anzeige]]` und `[[id]]`; ohne Anzeige ist der Text die id (die View setzt dann den
 * Glossar-Namen ein). Unvollständige Markierungen bleiben Text.
 */
export function parseTerms(text: string): TermSegment[] {
  const segments: TermSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    const index = match.index;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    const id = match[1] ?? '';
    segments.push({ kind: 'term', id, text: match[2] ?? id });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
