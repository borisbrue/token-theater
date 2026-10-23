// TST-0013 · CON-0012: RemoteEngine für OpenAI-kompatible Server, Regeln RE-01 bis RE-13.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Station, Token, Trace } from '@/trace/types';
import {
  DIALECT_MAX_TOP_N,
  PROMPT_TOKEN_ID,
  RemoteEngine,
  type Dialect,
  type RemoteConfig,
} from '@/engine/remote/remote-engine';
import { DIALECTS } from '@/engine/remote/dialects';
import { RemoteError } from '@/engine/remote/errors';
import { detectDialect, listModels } from '@/engine/remote/client';
import { contentTokenBytes, legacyTokenBytes } from '@/engine/remote/token-bytes';
import { StochasticSampler } from '@/engine/samplers/stochastic';
import { serializeTrace } from '@/trace/serialize';
import { validateTrace } from '@/trace/schema';
import { checkInvariants } from '@/trace/invariants';
import { createEngine } from '@/app/engine-factory';
import { createRng } from '@/engine/rng';

import { freshSetup, run } from './helpers/engine-setup';
import { assertViolation, lintAs } from './helpers/lint-as';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/remote', `${name}.json`), 'utf8'));

const BASE = 'https://llm.example/v1';
const KEY = 'sk-test-123';
const PROMPT = 'Die Katze sitzt auf dem';
const TOL = 1e-6;

function config(dialect: Dialect, topN = 5): RemoteConfig {
  return { baseUrl: BASE, apiKey: KEY, model: 'm', dialect, topN };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  signal: AbortSignal | null | undefined;
}

type Responder = (call: Call, index: number) => Response | Promise<Response>;

/** fetch-Double: zeichnet jede Anfrage auf und antwortet über `respond`. */
function fetchDouble(respond: Responder): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call: Call = { url, method: init.method ?? 'GET', headers, body, signal: init.signal };
      calls.push(call);
      return respond(call, calls.length - 1);
    },
  };
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/** Standard-Antworten wie in CON-0013: echo → legacy-echo, logprobs true → content-step. */
const standard: Responder = (call) => {
  if (call.url.endsWith('/models')) return json(fixture('models-legacy'));
  if (call.body?.['echo'] === true) return json(fixture('legacy-echo'));
  if (call.body?.['logprobs'] === true) return json(fixture('content-step'));
  return json(fixture('legacy-step'));
};

async function logitsOf(engine: RemoteEngine, context: Token[]): Promise<Station> {
  const stations: Station[] = [];
  for await (const station of engine.forward(context, [0, context.length])) stations.push(station);
  expect(stations).toHaveLength(1);
  const [only] = stations;
  if (only === undefined) throw new Error('keine Station');
  return only;
}

function expectDistribution(station: Station, texts: string[], probs: number[]): void {
  expect(station.kind).toBe('logits');
  if (station.kind !== 'logits') return;
  expect(station.distribution.map((c) => c.token.text)).toEqual(texts);
  station.distribution.forEach((c, i) => {
    expect(Math.abs(c.prob - (probs[i] ?? NaN))).toBeLessThan(TOL);
    expect(c.logit).toBeNull();
  });
  expect(station.vocabSize).toBeNull();
}

async function remoteError(promise: Promise<unknown>): Promise<RemoteError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteError);
    return error as RemoteError;
  }
  throw new Error('kein RemoteError');
}

async function prompted(engine: RemoteEngine, prompt = PROMPT): Promise<Token[]> {
  return engine.tokenizer.tokenize(prompt);
}

describe('RE-01 bis RE-03 Anfragen', () => {
  it('RE-01: legacy sendet Header, Body und Signal', async () => {
    const double = fetchDouble(standard);
    const engine = new RemoteEngine(config('legacy'), { fetch: double.fetch });
    const tokens = await prompted(engine);
    const controller = new AbortController();
    const stations: Station[] = [];
    for await (const s of engine.forward(tokens, [0, tokens.length], controller.signal)) {
      stations.push(s);
    }
    expect(double.calls).toHaveLength(2);
    const [echo, step] = double.calls;
    for (const call of [echo, step]) {
      expect(call?.url).toBe(`${BASE}/completions`);
      expect(call?.method).toBe('POST');
      expect(call?.headers['authorization']).toBe(`Bearer ${KEY}`);
      expect(call?.headers['content-type']).toBe('application/json');
    }
    expect(echo?.body).toEqual({
      model: 'm',
      prompt: PROMPT,
      max_tokens: 1,
      temperature: 1,
      logprobs: 5,
      echo: true,
    });
    expect(step?.body).toEqual({
      model: 'm',
      prompt: PROMPT,
      max_tokens: 1,
      temperature: 1,
      logprobs: 5,
    });
    expect(step?.signal).toBe(controller.signal);
  });

  it('RE-02: content sendet logprobs true und top_logprobs, nie echo', async () => {
    const double = fetchDouble(standard);
    const engine = new RemoteEngine(config('content'), { fetch: double.fetch });
    await logitsOf(engine, await prompted(engine));
    expect(double.calls).toHaveLength(1);
    expect(double.calls[0]?.body).toEqual({
      model: 'm',
      prompt: PROMPT,
      max_tokens: 1,
      temperature: 1,
      logprobs: true,
      top_logprobs: 5,
    });
  });

  it.each([
    ['legacy', 5, 5],
    ['legacy', 50, 20],
    ['legacy', 0, 20],
    ['content', 20, 10],
    ['content', 2.5, 10],
    ['content', 3, 3],
  ] as const)('RE-03: %s mit topN %s → %s', async (dialect, topN, expected) => {
    expect(DIALECT_MAX_TOP_N).toEqual({ legacy: 20, content: 10 });
    const double = fetchDouble(standard);
    const engine = new RemoteEngine(config(dialect, topN), { fetch: double.fetch });
    await logitsOf(engine, await prompted(engine));
    const last = double.calls.at(-1)?.body ?? {};
    expect(dialect === 'legacy' ? last['logprobs'] : last['top_logprobs']).toBe(expected);
  });
});

describe('RE-04 Verteilung legacy', () => {
  it('RE-04: legacy-step ergibt fünf Kandidaten mit Abdeckung', async () => {
    const engine = new RemoteEngine(config('legacy'), { fetch: fetchDouble(standard).fetch });
    const station = await logitsOf(engine, await prompted(engine));
    expectDistribution(
      station,
      [' Sofa', ' Boden', ' Dach', ' Tisch', ' Bett'],
      [0.558678, 0.205526, 0.103345, 0.080485, 0.051965],
    );
    if (station.kind === 'logits') {
      expect(Math.abs((station.coverage ?? NaN) - 0.436663)).toBeLessThan(TOL);
    }
  });

  it('RE-04: aus sechs Einträgen bleiben die fünf größten (ohne " Nest")', async () => {
    const respond: Responder = (call) =>
      call.body?.['echo'] === true ? json(fixture('legacy-echo')) : json(fixture('legacy-echo'));
    const engine = new RemoteEngine(config('legacy'), { fetch: fetchDouble(respond).fetch });
    const station = await logitsOf(engine, await prompted(engine));
    if (station.kind !== 'logits') throw new Error('keine logits-Station');
    expect(station.distribution.map((c) => c.token.text)).not.toContain(' Nest');
    expect(station.distribution).toHaveLength(5);
  });

  it('RE-04: synthetische IDs in Reihenfolge des ersten Auftretens, stabil und INV-10-sortiert', async () => {
    const engine = new RemoteEngine(config('legacy'), { fetch: fetchDouble(standard).fetch });
    const tokens = await prompted(engine);
    expect(tokens.map((t) => t.id)).toEqual([0, 1, 2, 3, 4, 5]);
    const first = await logitsOf(engine, tokens);
    if (first.kind !== 'logits') throw new Error('keine logits-Station');
    expect(first.distribution.map((c) => c.token.id)).toEqual([6, 7, 8, 9, 10]);
    const second = await logitsOf(engine, tokens);
    if (second.kind !== 'logits') throw new Error('keine logits-Station');
    expect(second.distribution.map((c) => c.token.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it('RE-04: Gleichstand wird nach ID sortiert, nicht endliche Logprobs entfallen', async () => {
    const response = {
      choices: [
        {
          text: ' x',
          logprobs: {
            tokens: [' x'],
            token_logprobs: [-1],
            top_logprobs: [{ ' b': -1, ' a': -1, ' c': -2, ' d': null }],
            text_offset: [0],
          },
        },
      ],
    };
    const respond: Responder = (call) =>
      call.body?.['echo'] === true ? json(fixture('legacy-echo')) : json(response);
    const engine = new RemoteEngine(config('legacy'), { fetch: fetchDouble(respond).fetch });
    const station = await logitsOf(engine, await prompted(engine));
    if (station.kind !== 'logits') throw new Error('keine logits-Station');
    expect(station.distribution).toHaveLength(3);
    const [x, y] = station.distribution;
    expect(x?.prob).toBe(y?.prob);
    expect((x?.token.id ?? 0) < (y?.token.id ?? 0)).toBe(true);
  });
});

describe('RE-05 Verteilung content', () => {
  it('RE-05: content-step mit echten IDs, Text aus Bytes, Gleichstand nach ID', async () => {
    const engine = new RemoteEngine(config('content'), { fetch: fetchDouble(standard).fetch });
    const station = await logitsOf(engine, await prompted(engine));
    expectDistribution(
      station,
      [' Dach', ' Tisch', ' Sofa', ' St', ' Baum'],
      [0.28076, 0.28076, 0.181272, 0.132622, 0.124586],
    );
    if (station.kind !== 'logits') return;
    expect(station.distribution.map((c) => c.token.id)).toEqual([
      181299, 182765, 58798, 769, 79383,
    ]);
    expect(Math.abs((station.coverage ?? NaN) - 0.618941)).toBeLessThan(TOL);
  });

  it('RE-05: gleiche ID wird zusammengefasst; leere Liste → no-logprobs', async () => {
    const make = (top: unknown[]) => ({
      choices: [
        {
          text: '',
          logprobs: { content: [{ id: 1, token: 'a', logprob: -1, top_logprobs: top }] },
        },
      ],
    });
    const merged = make([
      { id: 1, token: 'a', logprob: Math.log(0.3) },
      { id: 1, token: 'a', logprob: Math.log(0.2) },
      { id: 2, token: 'b', logprob: Math.log(0.25) },
    ]);
    const engine = new RemoteEngine(config('content'), {
      fetch: fetchDouble(() => json(merged)).fetch,
    });
    const station = await logitsOf(engine, await prompted(engine));
    if (station.kind !== 'logits') throw new Error('keine logits-Station');
    expect(station.distribution.map((c) => c.token.id)).toEqual([1, 2]);
    expect(Math.abs((station.distribution[0]?.prob ?? 0) - 0.5 / 0.75)).toBeLessThan(TOL);

    const empty = new RemoteEngine(config('content'), {
      fetch: fetchDouble(() => json(make([]))).fetch,
    });
    const error = await remoteError(logitsOf(empty, await prompted(empty)));
    expect(error.kind).toBe('no-logprobs');
  });
});

describe('RE-06 Token-Bytes', () => {
  it('RE-06: content über die GPT-2-Byte-Tabelle, sonst UTF-8', () => {
    expect(contentTokenBytes('ĠDach')).toEqual([32, 68, 97, 99, 104]);
    expect(contentTokenBytes('Ã¤')).toEqual([195, 164]);
    expect(contentTokenBytes('ðŁ¦Ĭ')).toEqual([240, 159, 166, 138]);
    expect(contentTokenBytes('中')).toEqual([228, 184, 173]);
  });

  it('RE-06: legacy als UTF-8, bytes:-Form und leer', () => {
    expect(legacyTokenBytes(' Sofa')).toEqual([...new TextEncoder().encode(' Sofa')]);
    expect(legacyTokenBytes('bytes:\\xe4\\xb8')).toEqual([228, 184]);
    expect(legacyTokenBytes('')).toEqual([]);
  });
});

describe('RE-07 Tokenizer', () => {
  it.each([
    ['legacy-echo', PROMPT, ['Die', ' Kat', 'ze', ' sitzt', ' auf', ' dem']],
    ['legacy-echo-bos', 'Die Katze', ['Die', ' Kat', 'ze']],
    ['legacy-echo-emoji', 'Ein Fuchs 🦊 und', ['Ein', ' F', 'uchs', '', '', ' 🦊', ' und']],
  ])('RE-07: legacy tokenisiert per echo (%s)', async (name, prompt, texts) => {
    const double = fetchDouble(() => json(fixture(name)));
    const engine = new RemoteEngine(config('legacy'), { fetch: double.fetch });
    const tokens = await engine.tokenizer.tokenize(prompt);
    expect(tokens.map((t) => t.text)).toEqual(texts);
    // Derselbe String hat dieselbe ID (RE-04): die beiden leeren Teil-Tokens teilen sich eine.
    const unique = [...new Set(texts)];
    expect(tokens.map((t) => t.id)).toEqual(texts.map((t) => unique.indexOf(t)));
    expect(double.calls[0]?.body?.['echo']).toBe(true);
    expect(engine.tokenizer.decode(tokens)).toBe(prompt);
    expect(engine.tokenizer.eosTokenId).toBeNull();
  });

  it('RE-07: passt keine Verkettung zum Prompt → format', async () => {
    const engine = new RemoteEngine(config('legacy'), {
      fetch: fetchDouble(() => json(fixture('legacy-echo'))).fetch,
    });
    const error = await remoteError(engine.tokenizer.tokenize('Ganz anderer Text'));
    expect(error.kind).toBe('format');
  });

  it('RE-07: content tokenisiert ohne Anfrage zu einem Prompt-Token', async () => {
    const double = fetchDouble(standard);
    const engine = new RemoteEngine(config('content'), { fetch: double.fetch });
    expect(PROMPT_TOKEN_ID).toBe(2147483647);
    expect(await engine.tokenizer.tokenize(PROMPT)).toEqual([
      { id: PROMPT_TOKEN_ID, text: PROMPT },
    ]);
    expect(double.calls).toHaveLength(0);
  });
});

describe('RE-08 Kontext als Prompt', () => {
  it('RE-08: content setzt Prompt und gewählte Tokens zusammen', async () => {
    const double = fetchDouble(standard);
    const engine = new RemoteEngine(config('content'), { fetch: double.fetch });
    const prompt = await prompted(engine);
    const station = await logitsOf(engine, prompt);
    if (station.kind !== 'logits') throw new Error('keine logits-Station');
    const dach = station.distribution[0]?.token;
    if (dach === undefined) throw new Error('kein Kandidat');
    await logitsOf(engine, [...prompt, dach]);
    expect(double.calls[1]?.body?.['prompt']).toBe('Die Katze sitzt auf dem Dach');
    expect(engine.tokenizer.decode([...prompt, dach])).toBe('Die Katze sitzt auf dem Dach');
  });

  it('RE-08: halbe UTF-8-Folgen über Tokengrenzen bleiben im Prompt heil', async () => {
    const half = {
      choices: [
        {
          text: '',
          logprobs: {
            content: [
              {
                id: 1,
                token: 'ðŁ',
                logprob: -1,
                top_logprobs: [
                  { id: 101, token: 'ðŁ', logprob: -1 },
                  { id: 102, token: '¦Ĭ', logprob: -2 },
                ],
              },
            ],
          },
        },
      ],
    };
    const double = fetchDouble(() => json(half));
    const engine = new RemoteEngine(config('content'), { fetch: double.fetch });
    const prompt = await engine.tokenizer.tokenize('Ein Fuchs ');
    const station = await logitsOf(engine, prompt);
    if (station.kind !== 'logits') throw new Error('keine logits-Station');
    const a = station.distribution.find((c) => c.token.id === 101)?.token;
    const b = station.distribution.find((c) => c.token.id === 102)?.token;
    if (a === undefined || b === undefined) throw new Error('Kandidaten fehlen');
    expect(a.text).toContain('�');
    await logitsOf(engine, [...prompt, a, b]);
    expect(double.calls[1]?.body?.['prompt']).toBe('Ein Fuchs 🦊');
  });
});

describe('RE-09 Fehler', () => {
  const cases: [string, Responder, string, string][] = [
    [
      'network',
      () => Promise.reject(new TypeError('fetch failed')),
      'network',
      `Der Server ist nicht erreichbar (${BASE}).`,
    ],
    [
      '401',
      () => json({ error: 'no' }, 401),
      'auth',
      'Der Server hat den API-Key abgelehnt (HTTP 401).',
    ],
    [
      '403',
      () => json({ error: 'no' }, 403),
      'auth',
      'Der Server hat den API-Key abgelehnt (HTTP 403).',
    ],
    [
      '429',
      () => json({ error: 'slow' }, 429),
      'rate-limit',
      'Der Server begrenzt die Anfragen (HTTP 429). Bitte kurz warten.',
    ],
    ['500', () => json({ error: 'x' }, 500), 'http', 'Der Server antwortete mit HTTP 500.'],
    [
      'kein JSON',
      () => new Response('<html>', { status: 200 }),
      'format',
      'Die Antwort des Servers hat ein unerwartetes Format.',
    ],
    [
      'ohne choices',
      () => json({ id: 'x' }),
      'format',
      'Die Antwort des Servers hat ein unerwartetes Format.',
    ],
    [
      'ohne logprobs',
      () => json({ choices: [{ text: ' a', logprobs: null }] }),
      'no-logprobs',
      'Der Server liefert keine Logprobs.',
    ],
  ];

  it.each(cases)('RE-09: %s', async (_name, respond, kind, message) => {
    const engine = new RemoteEngine(config('content'), { fetch: fetchDouble(respond).fetch });
    const error = await remoteError(logitsOf(engine, await prompted(engine)));
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(message);
    expect(error.name).toBe('RemoteError');
    expect(error.message).not.toContain(KEY);
  });

  it('RE-09: über generate endet der Lauf mit error und der Meldung', async () => {
    const engine = new RemoteEngine(config('content'), {
      fetch: fetchDouble(() => json({}, 429)).fetch,
    });
    const setup = await freshSetup({}, engine);
    const { trace } = await run(setup, PROMPT, 3);
    expect(trace.finishReason).toBe('error');
    expect(trace.error?.message).toBe(
      'Der Server begrenzt die Anfragen (HTTP 429). Bitte kurz warten.',
    );
    expect(trace.steps).toHaveLength(0);
  });
});

describe('RE-10 Abbruch', () => {
  it('RE-10: Abbruch während der Anfrage endet mit aborted', async () => {
    const controller = new AbortController();
    const respond: Responder = (call) =>
      new Promise((resolve, reject) => {
        call.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        if (call.signal === undefined || call.signal === null)
          resolve(json(fixture('content-step')));
      });
    const double = fetchDouble(respond);
    const engine = new RemoteEngine(config('content'), { fetch: double.fetch });
    const setup = await freshSetup({}, engine);
    const running = run(setup, PROMPT, 3, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const { trace } = await running;
    expect(trace.finishReason).toBe('aborted');
    expect(double.calls[0]?.signal).toBe(controller.signal);
  });

  it('RE-10: vorab abgebrochenes Signal → keine forward-Anfrage', async () => {
    const controller = new AbortController();
    controller.abort();
    const double = fetchDouble(standard);
    const engine = new RemoteEngine(config('content'), { fetch: double.fetch });
    const setup = await freshSetup({}, engine);
    const { trace } = await run(setup, PROMPT, 3, { signal: controller.signal });
    expect(trace.finishReason).toBe('aborted');
    expect(double.calls).toHaveLength(0);
  });
});

describe('RE-11 Client', () => {
  it('RE-11: listModels liest data[].id', async () => {
    const double = fetchDouble((call) =>
      json(
        fixture(
          call.headers['authorization'] === `Bearer ${KEY}` ? 'models-legacy' : 'models-content',
        ),
      ),
    );
    const models = await listModels({ baseUrl: BASE, apiKey: KEY }, { fetch: double.fetch });
    expect(models).toHaveLength(12);
    expect(models[0]).toBe('gpt-oss-120b');
    expect(double.calls[0]?.url).toBe(`${BASE}/models`);
    expect(double.calls[0]?.method).toBe('GET');
    const content = await listModels({ baseUrl: BASE, apiKey: 'other' }, { fetch: double.fetch });
    expect(content).toHaveLength(11);
    const denied = await remoteError(
      listModels({ baseUrl: BASE, apiKey: KEY }, { fetch: fetchDouble(() => json({}, 401)).fetch }),
    );
    expect(denied.kind).toBe('auth');
  });

  it.each([
    ['content-step', 'content'],
    ['legacy-step', 'legacy'],
  ] as const)('RE-11: detectDialect erkennt %s → %s', async (name, dialect) => {
    const double = fetchDouble(() => json(fixture(name)));
    expect(
      await detectDialect({ baseUrl: BASE, apiKey: KEY, model: 'm' }, { fetch: double.fetch }),
    ).toBe(dialect);
    expect(double.calls[0]?.body).toEqual({
      model: 'm',
      prompt: 'Hallo',
      max_tokens: 1,
      temperature: 1,
      logprobs: true,
      top_logprobs: 1,
    });
  });

  it('RE-11: detectDialect ohne Logprobs → no-logprobs', async () => {
    const double = fetchDouble(() => json({ choices: [{ text: 'x' }] }));
    const error = await remoteError(
      detectDialect({ baseUrl: BASE, apiKey: KEY, model: 'm' }, { fetch: double.fetch }),
    );
    expect(error.kind).toBe('no-logprobs');
  });
});

describe('RE-12 Läufe über den Generator', () => {
  async function remoteRun(
    dialect: Dialect,
    double: ReturnType<typeof fetchDouble>,
    sampler?: StochasticSampler,
    seed = 42,
  ): Promise<Trace> {
    const engine = new RemoteEngine(config(dialect), { fetch: double.fetch });
    const setup = await freshSetup({}, engine, sampler);
    return (await run(setup, PROMPT, 3, { seed })).trace;
  }

  function expectValid(trace: Trace): void {
    const serialized: unknown = JSON.parse(serializeTrace(trace));
    expect(validateTrace(serialized)).toEqual({ ok: true });
    expect(checkInvariants(serialized)).toEqual([]);
  }

  it('RE-12: legacy – Echo plus drei Schritte, Fähigkeiten und Prompts', async () => {
    const double = fetchDouble(standard);
    const trace = await remoteRun('legacy', double);
    expect(double.calls).toHaveLength(4);
    expect(double.calls[0]?.body?.['echo']).toBe(true);
    expect(double.calls.slice(1).every((c) => c.body?.['echo'] === undefined)).toBe(true);
    expect(trace.engine).toEqual({
      kind: 'remote-legacy',
      model: 'm',
      capabilities: ['tokenize', 'logits', 'sample'],
      architecture: null,
      eosTokenId: null,
    });
    expect(trace.steps.map((s) => s.stations.map((st) => st.kind))).toEqual([
      ['tokenize', 'logits', 'sample'],
      ['logits', 'sample'],
      ['logits', 'sample'],
    ]);
    expect(double.calls[2]?.body?.['prompt']).toBe('Die Katze sitzt auf dem Sofa');
    expect(trace.finishReason).toBe('max-tokens');
    expectValid(trace);
  });

  it('RE-12: content – drei Schritte ohne tokenize, Prompt-Token und Folge-Prompt', async () => {
    const double = fetchDouble(standard);
    const trace = await remoteRun('content', double);
    expect(double.calls).toHaveLength(3);
    expect(trace.engine.kind).toBe('remote-content');
    expect(trace.engine.capabilities).toEqual(['logits', 'sample']);
    expect(trace.steps[0]?.contextTokens).toEqual([{ id: PROMPT_TOKEN_ID, text: PROMPT }]);
    expect(double.calls[1]?.body?.['prompt']).toBe('Die Katze sitzt auf dem Dach');
    expectValid(trace);
  });

  it('RE-12: gleiche Antworten und gleicher Seed ergeben bytegleiche Traces ohne Key', async () => {
    const settings = { temperature: 1, topK: 0, topP: 1 };
    const a = serializeTrace(
      await remoteRun('legacy', fetchDouble(standard), new StochasticSampler(settings), 7),
    );
    const b = serializeTrace(
      await remoteRun('legacy', fetchDouble(standard), new StochasticSampler(settings), 7),
    );
    expect(a).toBe(b);
    expect(a).not.toContain(KEY);
  });
});

describe('RE-13a Dialekt-Registry', () => {
  it('RE-13a: Registry liefert IDs, Maxima, Tokenisierbarkeit und Erkennung', () => {
    expect(DIALECTS.map((d) => d.id)).toEqual(['legacy', 'content']);
    for (const dialect of DIALECTS) {
      expect(DIALECT_MAX_TOP_N[dialect.id]).toBe(dialect.maxTopN);
    }
    const [legacy, content] = DIALECTS;
    expect(legacy?.canTokenize).toBe(true);
    expect(content?.canTokenize).toBe(false);
    expect(legacy?.matches(fixture('legacy-step'))).toBe(true);
    expect(legacy?.matches(fixture('content-step'))).toBe(false);
    expect(content?.matches(fixture('content-step'))).toBe(true);
    expect(content?.matches(fixture('legacy-step'))).toBe(false);
  });
});

describe('RE-13 Factory und Schichtregel', () => {
  const deps = { createRng, idProvider: () => 'id', clock: () => '2026-10-22T00:00:00Z' };

  it('RE-13: createEngine baut die RemoteEngine, ohne Optionen ein Fehler', () => {
    const engine = createEngine('remote', deps, { remote: config('legacy') });
    expect(engine).toBeInstanceOf(RemoteEngine);
    expect(engine.info.model).toBe('m');
    expect(() => createEngine('remote', deps)).toThrow(Error);
  });

  it('RE-13: nur engine-factory.ts darf src/engine/remote importieren', async () => {
    const code =
      "import { RemoteEngine } from '../engine/remote/remote-engine';\n\nexport const R = RemoteEngine;\n";
    assertViolation(await lintAs(code, 'src/app/remote-check.ts'), [
      'import-x/no-restricted-paths',
    ]);
    const factory = await lintAs(code, 'src/app/engine-factory.ts');
    expect(factory.ruleIds).not.toContain('import-x/no-restricted-paths');
    const inner =
      "import { RemoteEngine } from './remote/remote-engine';\n\nexport const R = RemoteEngine;\n";
    assertViolation(await lintAs(inner, 'src/engine/generate-x.ts'), [
      'import-x/no-restricted-paths',
    ]);
  });

  it('RE-13: src/engine/remote erfüllt R-02 bis R-04', async () => {
    const target = 'src/engine/remote/rule-check.ts';
    assertViolation(await lintAs('export const r = Math.random();\n', target), [
      'no-restricted-syntax',
      'no-restricted-properties',
    ]);
    assertViolation(
      await lintAs(
        "import { deserializeTrace } from '../../trace/serialize';\nexport const d = deserializeTrace;\n",
        target,
      ),
      ['@typescript-eslint/no-restricted-imports'],
    );
    assertViolation(
      await lintAs('export function f(x: any): number {\n  return Number(x);\n}\n', target),
      ['@typescript-eslint/no-explicit-any'],
    );
  });
});
