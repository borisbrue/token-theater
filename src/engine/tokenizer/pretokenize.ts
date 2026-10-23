/**
 * Vorzerlegung wie GPT-2 (SPEC-0003 §3.2, CON-0008 B-02): Merges wirken nur innerhalb eines
 * Pre-Tokens. Die Verkettung aller Pre-Tokens ergibt wieder den Text.
 */
export const GPT2_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export function pretokenize(text: string): string[] {
  // matchAll arbeitet auf einer Kopie des Musters; lastIndex des Exports bleibt unberührt.
  return Array.from(text.matchAll(GPT2_PATTERN), (match) => match[0]);
}
