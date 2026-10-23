// TST-0028 · CON-0026 PT-01..PT-05: Python-Werkzeuge, Beispielsonden und Bericht-Fixture, ohne Python.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { BpeTokenizer } from '@/engine/tokenizer/bpe';
import { GPT2_EOS_TOKEN_ID, parseGpt2Tables } from '@/engine/tokenizer/gpt2';
import { parseProbe, parseReport } from '@/probe/import';
import type { Probe, ProbeReport } from '@/probe/types';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const toolDir = join(repoRoot, 'scripts/moe-export');
const probeDir = join(repoRoot, 'scripts/probes');
const FIXTURE = 'tests/fixtures/probe/tiny-occupation-gender-en.probe-report.json';

const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

/** Abschnitt `[name]` einer TOML-Datei bis zum nächsten Abschnittskopf. */
function tomlSection(toml: string, name: string): string {
  const lines = toml.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start < 0) return '';
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** SPEC-0012 §3.8. */
const PROBES = [
  {
    file: 'occupation-gender-en.probe.json',
    attribute: 'gender',
    language: 'en',
    targets: [' he', ' she'],
  },
  {
    file: 'beruf-geschlecht-de.probe.json',
    attribute: 'gender',
    language: 'de',
    targets: [' er', ' sie'],
  },
  {
    file: 'name-origin-en.probe.json',
    attribute: 'origin',
    language: 'en',
    targets: [' good', ' bad'],
  },
  {
    file: 'age-en.probe.json',
    attribute: 'age',
    language: 'en',
    targets: [' capable', ' slow'],
  },
] as const;

let tokenizer: BpeTokenizer;

beforeAll(() => {
  const tables = parseGpt2Tables(
    read('public/tokenizers/gpt2/vocab.json'),
    read('public/tokenizers/gpt2/merges.txt'),
  );
  tokenizer = new BpeTokenizer(tables, { eosTokenId: GPT2_EOS_TOKEN_ID });
});

describe('PT-01 uv-Projekt', () => {
  it('PT-01: probe.py, verify_weights.py und ihre Python-Tests existieren', () => {
    for (const file of [
      'probe.py',
      'verify_weights.py',
      'tests/test_probe.py',
      'tests/test_verify_weights.py',
    ]) {
      expect(existsSync(join(toolDir, file)), file).toBe(true);
    }
  });

  it('PT-01: pyproject.toml nennt jsonschema und huggingface_hub, uv.lock enthält beide', () => {
    const project = tomlSection(read('scripts/moe-export/pyproject.toml'), 'project');
    expect(project).toMatch(/["']jsonschema([<>=~! ].*)?["']/);
    expect(project).toMatch(/["']huggingface[_-]hub([<>=~! ].*)?["']/);
    const lock = read('scripts/moe-export/uv.lock');
    expect(lock).toContain('name = "jsonschema"');
    expect(lock).toContain('name = "huggingface-hub"');
    const files = readdirSync(toolDir);
    expect(files.filter((f) => /^requirements.*\.txt$/.test(f))).toEqual([]);
  });
});

describe('PT-02 npm-Skripte', () => {
  it('PT-02: probe und verify-weights laufen über uv', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['probe']).toBe(
      'uv run --project scripts/moe-export scripts/moe-export/probe.py',
    );
    expect(pkg.scripts['verify-weights']).toBe(
      'uv run --project scripts/moe-export scripts/moe-export/verify_weights.py',
    );
  });
});

describe('PT-03 Kommandozeile', () => {
  it('PT-03: Optionen von probe.py, Schema-Datei und Meldung für mehrteilige Ziele', () => {
    const source = read('scripts/moe-export/probe.py');
    for (const option of [
      '--model',
      '--tiny-random',
      '--probe',
      '--out',
      '--seed',
      '--top-n',
      '--traces',
    ]) {
      expect(source, option).toContain(`"${option}"`);
    }
    expect(source).toContain('probe-format.schema.json');
    expect(source).toContain('ist kein einzelnes Token');
  });

  it('PT-03: Optionen, Ausgaben und Exit-Codes von verify_weights.py', () => {
    const source = read('scripts/moe-export/verify_weights.py');
    for (const option of ['--model', '--revision', '--local', '--reference', '--out', '--top']) {
      expect(source, option).toContain(`"${option}"`);
    }
    for (const word of ['"ok"', '"abweichend"', '"nicht prüfbar"']) {
      expect(source, word).toContain(word);
    }
    expect(source).toMatch(/\b3\b/);
    expect(source).toContain('sha256');
    expect(source).toContain('safe_open');
  });

  it('PT-03: Python-Tests decken mehrteilige Ziele, Referenzvergleich und Hub-Fehler ab', () => {
    const probeTests = read('scripts/moe-export/tests/test_probe.py');
    expect(probeTests).toMatch(/kein einzelnes Token|multi/i);
    const weightTests = read('scripts/moe-export/tests/test_verify_weights.py');
    for (const word of ['reference', 'shapeMismatch', 'nicht prüfbar']) {
      expect(weightTests, word).toContain(word);
    }
  });
});

describe('PT-04 Beispielsonden', () => {
  it('PT-04: genau die vier Sonden aus SPEC-0012 §3.8', () => {
    const files = readdirSync(probeDir).filter((f) => f.endsWith('.probe.json'));
    expect(files.sort()).toEqual(PROBES.map((p) => p.file).sort());
  });

  for (const expected of PROBES) {
    describe(expected.file, () => {
      let probe: Probe;
      beforeAll(() => {
        probe = parseProbe(readFileSync(join(probeDir, expected.file), 'utf8'));
      });

      it('PT-04: Name, Sprache und 12 Paare mit Merkmal und Zielen der Tabelle', () => {
        expect(probe.name).toBe(expected.file.replace(/\.probe\.json$/, ''));
        expect(probe.language).toBe(expected.language);
        expect(probe.description.length).toBeGreaterThan(0);
        expect(probe.pairs).toHaveLength(12);
        for (const pair of probe.pairs) {
          expect(pair.attribute, pair.id).toBe(expected.attribute);
          expect(pair.targets, pair.id).toEqual(expected.targets);
        }
      });

      it('PT-04: letztes Paar ist die Kontrolle mit a = b, die anderen haben a ≠ b', () => {
        const last = probe.pairs.at(-1);
        expect(last?.id).toBe('control');
        expect(last?.a).toBe(last?.b);
        for (const pair of probe.pairs.slice(0, -1)) expect(pair.a, pair.id).not.toBe(pair.b);
      });
    });
  }

  it('PT-04: Ziele der englischen Sonden sind je ein GPT-2-Token, „ sie“ ist mehr als eines', () => {
    for (const expected of PROBES.filter((p) => p.language === 'en')) {
      for (const target of expected.targets) {
        expect(tokenizer.encode(target), `${expected.file}: „${target}“`).toHaveLength(1);
      }
    }
    expect(tokenizer.encode(' sie').length).toBeGreaterThan(1);
  });
});

describe('PT-05 Bericht-Fixture', () => {
  let report: ProbeReport;
  let probe: Probe;
  beforeAll(() => {
    report = parseReport(read(FIXTURE));
    probe = parseProbe(read('scripts/probes/occupation-gender-en.probe.json'));
  });

  it('PT-05: Kopf des Berichts', () => {
    expect(report.probe).toBe('occupation-gender-en');
    expect(report.model).toBe('tiny-random-gpt2');
    expect(report.generator).toBe('probe.py');
    expect(report.createdAt).toBe('2026-10-23T00:00:00Z');
  });

  it('PT-05: Paare in der Reihenfolge der Sonde mit deren Prompts und Zielen', () => {
    expect(report.pairs.map((p) => [p.id, p.attribute, p.a, p.b])).toEqual(
      probe.pairs.map((p) => [p.id, p.attribute, p.a, p.b]),
    );
    for (const pair of report.pairs) {
      expect(pair.targets.map((t) => [t.text, t.id])).toEqual([
        [' he', 339],
        [' she', 673],
      ]);
      expect(pair.topA).toHaveLength(5);
      expect(pair.topB).toHaveLength(5);
    }
    expect(report.summary.pairs).toBe(12);
    expect(report.pairs.some((pair) => pair.flip === true)).toBe(true);
  });

  it('PT-05: Kontrolle hat pA = pB, js 0 und keinen Umschwung', () => {
    const control = report.pairs.find((p) => p.id === 'control');
    expect(control).toBeDefined();
    for (const target of control?.targets ?? []) expect(target.pA).toBe(target.pB);
    expect(control?.js ?? 1).toBeLessThanOrEqual(1e-9);
    expect(control?.flip).toBe(false);
  });
});
