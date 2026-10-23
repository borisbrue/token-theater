import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import jsxNoLiterals from './eslint-rules/jsx-no-literals.js';

// Architektur- und Werkzeugregeln: CON-0004 (R-02 bis R-05, R-08).

const LAYERS = 'Schichtgrenze (CON-0004 R-03)';

/** R-03: Schichtgrenzen über aufgelöste Pfade (erfasst relative Importe und den Alias @/). */
const LAYER_ZONES = [
  { target: './src/engine', from: ['./src/app', './src/views', './src/playback'], message: LAYERS },
  { target: './src/trace', from: ['./src/app', './src/views', './src/playback'], message: LAYERS },
  { target: './src/trace', from: './src/engine', message: LAYERS },
  { target: './src/views', from: ['./src/engine', './src/app'], message: LAYERS },
  { target: './src/playback', from: ['./src/engine', './src/app', './src/views'], message: LAYERS },
  // SPEC-0004 CON-0010 S-10: reine Sampling-Mathematik, nutzbar von Engine und Views.
  {
    target: './src/sampling',
    from: ['./src/engine', './src/app', './src/views', './src/playback'],
    message: LAYERS,
  },
];

/** R-03: Konkrete Engines entstehen nur in src/app/engine-factory.ts (Factory Method). */
const CONCRETE_ENGINES = 'Konkrete Engines nur über src/app/engine-factory.ts (CON-0004 R-03)';
const CONCRETE_ENGINE_ZONES = [
  { target: './src/app', from: './src/engine/mock', message: CONCRETE_ENGINES },
  // Auch innerhalb von engine/: nur mock/ selbst darf seine Module importieren.
  {
    target: ['./src/engine/*.ts', './src/engine/!(mock)/**/*'],
    from: './src/engine/mock',
    message: CONCRETE_ENGINES,
  },
  // SPEC-0006: dasselbe für die GPT-2-Engine.
  { target: './src/app', from: './src/engine/gpt2', message: CONCRETE_ENGINES },
  {
    target: ['./src/engine/*.ts', './src/engine/!(gpt2)/**/*'],
    from: './src/engine/gpt2',
    message: CONCRETE_ENGINES,
  },
  // SPEC-0005: dasselbe für die RemoteEngine.
  { target: './src/app', from: './src/engine/remote', message: CONCRETE_ENGINES },
  {
    target: ['./src/engine/*.ts', './src/engine/!(remote)/**/*'],
    from: './src/engine/remote',
    message: CONCRETE_ENGINES,
  },
];

const REACT_IMPORTS = {
  paths: [
    { name: 'react', message: 'engine/ und trace/ kennen kein React (CON-0004 R-03)' },
    { name: 'react-dom', message: 'engine/ und trace/ kennen kein React (CON-0004 R-03)' },
  ],
  patterns: [
    {
      group: ['react/*', 'react-dom/*'],
      message: 'engine/ und trace/ kennen kein React (CON-0004 R-03)',
    },
  ],
};

const DETERMINISM = 'Zufall, Zeit und IDs kommen aus deps (CON-0004 R-04)';

/** R-04: Selektoren erfassen auch globalThis./window.-Zugriffe und Destrukturierung. */
const DETERMINISM_SYNTAX = [
  "MemberExpression[object.name='Math'][property.name='random']",
  "MemberExpression[object.name=/^(Date|performance)$/][property.name='now']",
  "MemberExpression[object.property.name='performance'][property.name='now']",
  'MemberExpression[property.name=/^(randomUUID|getRandomValues)$/]',
  "CallExpression[callee.name='Date']",
  "NewExpression[callee.name='Date'][arguments.length=0]",
  "VariableDeclarator[id.type='ObjectPattern'][init.name=/^(Date|Math|performance|crypto)$/]",
].map((selector) => ({ selector, message: DETERMINISM }));

const TIMERS = 'Zeit nur über den injizierten Scheduler (CON-0005 INV-08)';

/** CON-0005 INV-08: src/playback nutzt Zeit nur über die Scheduler-Strategy. */
const TIMER_SYNTAX = [
  'CallExpression[callee.name=/^(setTimeout|setInterval|requestAnimationFrame)$/]',
  'MemberExpression[property.name=/^(setTimeout|setInterval|requestAnimationFrame)$/]',
].map((selector) => ({ selector, message: TIMERS }));

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.sdd/**',
      'tests/fixtures/**',
      'node_modules/**',
    ],
  },
  {
    // R-08: Inline-Konfiguration wirkt nicht; unterdrückte Fehler bleiben sichtbar.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true, 'ts-check': false },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        { zones: [...LAYER_ZONES, ...CONCRETE_ENGINE_ZONES] },
      ],
    },
  },
  {
    // Die Factory ist die eine Stelle, die konkrete Engines importieren darf.
    files: ['src/app/engine-factory.ts'],
    rules: {
      'import-x/no-restricted-paths': ['error', { zones: LAYER_ZONES }],
    },
  },
  {
    // R-02, R-03, R-04 für engine/: kein any, kein React, aus trace/ nur Typen, kein Zufall/keine Zeit.
    files: ['src/engine/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          ...REACT_IMPORTS,
          patterns: [
            ...REACT_IMPORTS.patterns,
            {
              regex: '(^@/|/)trace/',
              allowTypeImports: true,
              message: 'engine/ importiert aus trace/ nur Typen (import type, CON-0004 R-03)',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX],
    },
  },
  {
    // CON-0010 S-10 für sampling/: kein any, kein React, aus trace/ nur Typen, kein Zufall/keine Zeit.
    files: ['src/sampling/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          ...REACT_IMPORTS,
          patterns: [
            ...REACT_IMPORTS.patterns,
            {
              regex: '(^@/|/)trace(/|$)',
              allowTypeImports: true,
              message: 'sampling/ importiert aus trace/ nur Typen (import type, CON-0010 S-10)',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX],
    },
  },
  {
    // INV-08: Zeit- und Zufalls-APIs nur in scheduler.ts.
    files: ['src/playback/**/*.ts'],
    ignores: ['src/playback/scheduler.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX, ...TIMER_SYNTAX],
    },
  },
  {
    files: ['src/trace/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': ['error', REACT_IMPORTS],
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX],
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // R-05: sichtbare Texte nur aus src/app/texts.ts. Projekteigene Regel statt react/jsx-no-literals,
    // weil dessen Optionen erlaubte Props (className, htmlFor, data-* …) nicht einzeln ausnehmen
    // können; CON-0004 R-05 sieht dafür ausdrücklich eine Regel unter eslint-rules/ vor.
    files: ['src/app/**/*.tsx', 'src/views/**/*.tsx'],
    plugins: { local: { rules: { 'jsx-no-literals': jsxNoLiterals } } },
    rules: {
      'local/jsx-no-literals': 'error',
    },
  },
  {
    files: ['*.config.{ts,js}', 'tests/**/*.ts', 'eslint-rules/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
