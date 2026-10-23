import type { Token } from '../../trace/types';
import { utf8Bytes } from './token-bytes';

/**
 * IDs und Bytes der Tokens eines Laufs (SPEC-0005 §3.4, CON-0012 RE-04/RE-07): synthetische IDs
 * für Server ohne IDs (in Reihenfolge des ersten Auftretens) und die Bytes je ID, damit der
 * nächste Prompt auch über halbe UTF-8-Folgen hinweg korrekt entsteht.
 */
export class TokenRegistry {
  private readonly idByKey = new Map<string, number>();
  private readonly bytesById = new Map<number, number[]>();
  private next = 0;

  /** Synthetische ID eines Token-Strings; derselbe String behält seine ID. */
  idFor(key: string): number {
    let id = this.idByKey.get(key);
    if (id === undefined) {
      id = this.next;
      this.next += 1;
      this.idByKey.set(key, id);
    }
    return id;
  }

  remember(id: number, bytes: readonly number[]): void {
    if (!this.bytesById.has(id)) this.bytesById.set(id, [...bytes]);
  }

  /** Bekannte Bytes der ID, sonst UTF-8 des Textes. */
  bytesOf(token: Token): number[] {
    return this.bytesById.get(token.id) ?? utf8Bytes(token.text);
  }
}
