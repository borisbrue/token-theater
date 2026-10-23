import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

/** Wurzel des Repositorys (tests/unit/helpers → ../../..). */
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'lint');

export interface LintMessageSummary {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  fatal: boolean;
}

export interface LintResult {
  ruleIds: Array<string | null>;
  severities: number[];
  fatal: boolean;
  ignored: boolean;
  messages: LintMessageSummary[];
}

let instance: ESLint | undefined;

function eslint(): ESLint {
  instance ??= new ESLint({ cwd: repoRoot });
  return instance;
}

/**
 * Facade über die ESLint-Node-API: lintet `code` so, als läge es unter `virtualPath`
 * (relativ zur Repo-Wurzel), mit der Projektkonfiguration.
 */
export async function lintAs(code: string, virtualPath: string): Promise<LintResult> {
  const filePath = path.join(repoRoot, virtualPath);
  const ignored = await eslint().isPathIgnored(filePath);
  const results = await eslint().lintText(code, { filePath, warnIgnored: true });
  const messages: LintMessageSummary[] = (results[0]?.messages ?? []).map((m) => ({
    ruleId: m.ruleId,
    severity: m.severity,
    message: m.message,
    line: m.line,
    fatal: m.fatal === true,
  }));
  return {
    ruleIds: messages.map((m) => m.ruleId),
    severities: messages.map((m) => m.severity),
    fatal: messages.some((m) => m.fatal),
    ignored,
    messages,
  };
}

function describeMessages(result: LintResult): string {
  if (result.messages.length === 0) return '(keine Meldungen)';
  return result.messages
    .map((m) => `  Z.${m.line} [${m.ruleId ?? 'null'}/${m.severity}] ${m.message}`)
    .join('\n');
}

/**
 * Verstoß gilt nur als nachgewiesen, wenn eine der erwarteten ruleIds mit severity 2
 * gemeldet wird, die Datei nicht ignoriert ist und kein Parse-Fehler vorliegt (CON-0004 INV-02).
 */
export function assertViolation(result: LintResult, expectedRuleIds: readonly string[]): void {
  if (result.ignored) throw new Error('Datei wird von ESLint ignoriert');
  if (result.fatal) {
    throw new Error(`Parse-Fehler statt Regelverstoß:\n${describeMessages(result)}`);
  }
  const hit = result.messages.some(
    (m) => m.severity === 2 && m.ruleId !== null && expectedRuleIds.includes(m.ruleId),
  );
  if (!hit) {
    const expected = expectedRuleIds.join(', ');
    throw new Error(
      `Erwartet: eine von [${expected}] mit severity 2, erhalten:\n${describeMessages(result)}`,
    );
  }
}

/** Gegenbeispiel: 0 Meldungen und nicht ignoriert. */
export function assertClean(result: LintResult): void {
  if (result.ignored) throw new Error('Datei wird von ESLint ignoriert');
  if (result.messages.length > 0) {
    throw new Error(`Erwartet: 0 Meldungen, erhalten:\n${describeMessages(result)}`);
  }
}

export interface LintFixture {
  /** Pfad relativ zu tests/fixtures/lint */
  file: string;
  /** Regel-ID aus dem Ordnernamen, z. B. "R-03" für r03-layers */
  rule: string;
  kind: 'bad' | 'good';
  /** Virtueller Zielpfad aus dem Kopfkommentar `// @lint-target:` */
  target: string;
  /** Erwartete ruleIds aus `// @lint-expect:` (leer bei `none`) */
  expect: string[];
  code: string;
}

const TARGET_RE = /^\/\/ @lint-target: (\S+)\s*$/m;
const EXPECT_RE = /^\/\/ @lint-expect: (.+?)\s*$/m;
const RULE_DIR_RE = /^r(\d{2})-/;
const KIND_RE = /\.(bad|good)\.tsx?\.fixture$/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Liest alle Fixtures samt Kopfkommentaren. Fehlerhafte Köpfe führen zu einem Fehler. */
export function loadFixtures(): LintFixture[] {
  return walk(fixtureRoot)
    .filter((full) => KIND_RE.test(full))
    .sort()
    .map((full) => {
      const file = path.relative(fixtureRoot, full).split(path.sep).join('/');
      const code = readFileSync(full, 'utf8');
      const target = TARGET_RE.exec(code)?.[1];
      const expectRaw = EXPECT_RE.exec(code)?.[1];
      const ruleDir = RULE_DIR_RE.exec(file)?.[1];
      const kind = KIND_RE.exec(file)?.[1];
      if (!target || !expectRaw || !ruleDir || (kind !== 'bad' && kind !== 'good')) {
        throw new Error(`Fixture ${file}: Kopfkommentar oder Dateiname unvollständig`);
      }
      const expect =
        expectRaw === 'none'
          ? []
          : expectRaw
              .split('|')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
      if (kind === 'bad' && expect.length === 0) {
        throw new Error(`Fixture ${file}: Verstoß ohne erwartete ruleId`);
      }
      if (kind === 'good' && expect.length > 0) {
        throw new Error(`Fixture ${file}: Gegenbeispiel muss "@lint-expect: none" tragen`);
      }
      return { file, rule: `R-${ruleDir}`, kind, target, expect, code };
    });
}
