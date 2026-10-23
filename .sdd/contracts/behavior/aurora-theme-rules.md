# Aurora-Theme-Regeln (CON-0007)

Umsetzung von ADR-0001. Jede Regel nennt ihren Prüfmechanismus (TST-0007, Vitest, Node).
„Theme-CSS“ bezeichnet alle `*.css`-Dateien unter `src/app/theme/`; „alle CSS“ alle `*.css`
unter `src/`.

## T-01 Tokens
*Prüfung: Theme-CSS parsen und mit `src/app/theme/tokens.ts` vergleichen.*

Die Regel `:root` in `src/app/theme/tokens.css` definiert mindestens diese Farb-Tokens mit exakt
diesen Werten (Hex, Kleinbuchstaben): `--tt-bg #070b14`, `--tt-surface #0d1424`,
`--tt-surface-2 #121c31`, `--tt-line #1f2b45`, `--tt-line-strong #2a3a5e`, `--tt-text #e6f1ff`,
`--tt-text-soft #d4e2f7`, `--tt-text-muted #8ea3c4`, `--tt-mint #34f5a4`, `--tt-cyan #2ee6e6`,
`--tt-blue #4c7dff`, `--tt-blue-deep #1b3a8a`, `--tt-violet #8b5cf6`, `--tt-error #ff5c8a`,
`--tt-on-accent #04131a`.

Jede **weitere** Variable mit Farbbezug (Glow, Verläufe) enthält keine Farbliterale, sondern nur
`var(--tt-…)` und `color-mix(…)` über diese. Pflicht sind `--tt-gradient-aurora`,
`--tt-gradient-sky` und `--tt-gradient-data`.

`tokens.ts` exportiert:
- `COLORS`: Record mit den Token-Namen **ohne** `--tt-` als Schlüssel (`bg`, `surface-2`,
  `text-muted`, `on-accent`, …) und denselben Hex-Werten.
- `DATA_SCALE`: `[{ at: 0, color: COLORS.surface }, { at: 0.35, color: COLORS['blue-deep'] },
  { at: 0.72, color: COLORS.cyan }, { at: 1, color: COLORS.mint }]`.

## T-02 Kontrast
*Prüfung: WCAG-2.1-Kontrastverhältnis aus `COLORS` berechnen.*

Text-Paare mit mindestens 4.5:1:

| Vordergrund | Hintergründe |
|---|---|
| `text`, `text-soft`, `text-muted` | `bg`, `surface`, `surface-2` |
| `mint`, `cyan`, `error` | `bg`, `surface`, `surface-2` |
| `on-accent` | `mint`, `cyan`, `blue` |

Nicht-Text (WCAG 1.4.11) mit mindestens 3:1: `cyan` (Fokusring) gegen `bg`, `surface`,
`surface-2`.

## T-03 Farbwerte nur im Theme
*Prüfung: Dateiscan.*

Gescannt werden alle `*.ts`, `*.tsx`, `*.css` und `*.html` unter `src/` sowie `index.html`,
außer Dateien unter `src/app/theme/`. Kommentare zählen mit. Verboten sind Treffer von:
- Hex: `/(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/`
- Farbfunktionen: `/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/`

Benannte Farben sind außerhalb des Themes ebenfalls verboten, außer `transparent`, `inherit`
und `currentColor` (Prüfung nur in `*.css`: Werte von `color`, `background`, `background-color`,
`border*-color`, `outline-color`, `fill`, `stroke`).

## T-04 Schriften gebündelt
*Prüfung: `package.json`, Theme-CSS und Quellen lesen.*

`dependencies` enthält `@fontsource/space-grotesk`, `@fontsource-variable/inter` und
`@fontsource/jetbrains-mono`. Eine Datei unter `src/app/theme/` importiert sie (TS-`import` oder
CSS-`@import`). Kein Quelltext unter `src/` und `index.html` enthält `fonts.googleapis.com` oder
`fonts.gstatic.com`. Die `:root`-Regel in `tokens.css` setzt `--tt-font-display`,
`--tt-font-body` und `--tt-font-mono`; ihr erster Eintrag ist `'Space Grotesk'`,
`'Inter Variable'` bzw. `'JetBrains Mono'`.

## T-05 Reduzierte Bewegung
*Prüfung: Theme-CSS parsen.*

Ein Block `@media (prefers-reduced-motion: reduce)` enthält eine Regel mit dem Selektor
`*, *::before, *::after`, die `transition-duration: 0s !important`,
`animation-duration: 0s !important` und `animation-iteration-count: 1 !important` setzt.

## T-06 Nur Dark Mode
*Prüfung: alle CSS parsen.*

Die `:root`-Regel in `tokens.css` setzt `color-scheme: dark`. Keine CSS-Datei unter `src/`
enthält `prefers-color-scheme: light`.

## T-07 Fokusring
*Prüfung: Theme-CSS parsen.*

Eine Regel mit dem Selektor `:focus-visible` setzt `outline` mit `var(--tt-cyan)`, einer Breite
≥ 2px, sowie `outline-offset` ≥ 2px.

## T-08 ADR und Code stimmen überein
*Prüfung: Tabelle in `docs/adr/ADR-0001-aurora-design-language.md` parsen.*

Jede Tabellenzeile der Form `| … | \`--tt-x\` | \`#hex\` |` hat einen Eintrag `COLORS['x']` mit
demselben Wert, und jeder Schlüssel von `COLORS` kommt in der Tabelle vor.
