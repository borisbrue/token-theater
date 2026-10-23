/** Fehler der RemoteEngine (SPEC-0005 §3.5, CON-0012 RE-09); die Meldung geht in den Trace. */

export type RemoteErrorKind = 'network' | 'auth' | 'rate-limit' | 'http' | 'format' | 'no-logprobs';

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;

  constructor(kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
  }
}

export function unreachable(baseUrl: string): RemoteError {
  return new RemoteError('network', `Der Server ist nicht erreichbar (${baseUrl}).`);
}

export function httpError(status: number): RemoteError {
  if (status === 401 || status === 403) {
    return new RemoteError('auth', `Der Server hat den API-Key abgelehnt (HTTP ${status}).`);
  }
  if (status === 429) {
    return new RemoteError(
      'rate-limit',
      'Der Server begrenzt die Anfragen (HTTP 429). Bitte kurz warten.',
    );
  }
  return new RemoteError('http', `Der Server antwortete mit HTTP ${status}.`);
}

export function badFormat(): RemoteError {
  return new RemoteError('format', 'Die Antwort des Servers hat ein unerwartetes Format.');
}

export function noLogprobs(): RemoteError {
  return new RemoteError('no-logprobs', 'Der Server liefert keine Logprobs.');
}
