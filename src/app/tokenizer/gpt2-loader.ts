import type { BpeTokenizer } from '../../engine/tokenizer/bpe';
import { loadGpt2Tokenizer } from '../../engine/tokenizer/gpt2';

let pending: Promise<BpeTokenizer> | null = null;

/**
 * Virtual Proxy (SPEC-0003 §3.6): lädt das GPT-2-Vokabular erst beim ersten Aufruf vom eigenen
 * Origin und danach nie wieder; ein Fehlschlag wird verworfen, der nächste Aufruf lädt neu.
 */
export function getGpt2Tokenizer(): Promise<BpeTokenizer> {
  if (pending === null) {
    const attempt = loadGpt2Tokenizer({ baseUrl: import.meta.env.BASE_URL });
    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) pending = null;
    });
  }
  return pending;
}
