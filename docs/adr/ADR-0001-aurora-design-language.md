---
id: ADR-0001
title: 'Aurora design language'
status: accepted # proposed | accepted | rejected | superseded | deprecated
date: 2026-10-21
deciders: ['Boris']
related_specs: ['SPEC-0002']
supersedes: ''
---

# ADR-0001: Aurora design language

## Status

accepted (2026-10-21, Boris). Visueller Entwurf: Design-Leinwand „Token Theater – Aurora“
(https://claude.ai/artifact/JS7xoqJEvzD21aimVtLKjs, Artboards „Aurora – Designsprache“ und
„Player (SPEC-0002) – Mockup“).

## Kontext

Bis SPEC-0001 hatte Token Theater nur eine minimale `index.css`. Ab SPEC-0002 entstehen echte
Ansichten (Transportleiste, Zeitleiste, Stationsansicht), die für Vortrag am Beamer und für
Selbstlernen gleichermaßen funktionieren müssen. Gewünscht ist ein dunkler Look mit Verläufen,
„ein wenig Cyberpunk, aber in Grün und Blau – Aurora Borealis“.

## Optionen

### Option A: Neutrales Dark-Theme (z. B. Tailwind-Grautöne + ein Akzent)

- **Pro:** schnell, wenig Pflege
- **Contra:** keine eigene Identität, erfüllt den Wunsch nach Verläufen und Cyberpunk nicht

### Option B: Voll-Cyberpunk (Neon-Magenta/Gelb, Glitch, Scanlines überall)

- **Pro:** starke Wirkung
- **Contra:** Effekte konkurrieren mit den Daten, ermüdet bei langen Erklärungen, Kontrastprobleme am Beamer

### Option C: „Aurora“ – Nachthimmel mit Polarlicht-Akzenten

- **Pro:** eigene Identität; Licht trägt Bedeutung („was leuchtet, ist aktiv“); Grün/Blau-Palette mit guter Lesbarkeit; Verläufe gezielt statt flächig
- **Contra:** braucht Disziplin bei Glow und Verläufen, eigene Schriften müssen gebündelt werden

## Entscheidung

**Option C, „Aurora“.** Verbindliche Tokens (CSS Custom Properties, Präfix `--tt-`):

| Rolle                 | Token              | Wert      |
| --------------------- | ------------------ | --------- |
| Grund (Nachthimmel)   | `--tt-bg`          | `#070b14` |
| Fläche                | `--tt-surface`     | `#0d1424` |
| Fläche erhöht         | `--tt-surface-2`   | `#121c31` |
| Linie                 | `--tt-line`        | `#1f2b45` |
| Linie stark           | `--tt-line-strong` | `#2a3a5e` |
| Text                  | `--tt-text`        | `#e6f1ff` |
| Text gedämpft         | `--tt-text-soft`   | `#d4e2f7` |
| Text leise            | `--tt-text-muted`  | `#8ea3c4` |
| Aurora-Mint           | `--tt-mint`        | `#34f5a4` |
| Aurora-Cyan           | `--tt-cyan`        | `#2ee6e6` |
| Aurora-Blau           | `--tt-blue`        | `#4c7dff` |
| Tiefblau (Datenskala) | `--tt-blue-deep`   | `#1b3a8a` |
| Polar-Violett         | `--tt-violet`      | `#8b5cf6` |
| Fehler                | `--tt-error`       | `#ff5c8a` |
| Text auf Aurora-Band  | `--tt-on-accent`   | `#04131a` |

Verläufe: `--tt-gradient-aurora` (100°, Mint → Cyan → Blau), `--tt-gradient-sky`
(Radialverläufe Mint/Cyan/Violett über `--tt-bg`), `--tt-gradient-data`
(Surface → Tiefblau → Cyan → Mint, Stopps 0 / 0.35 / 0.72 / 1). Verläufe und Glow-Farben werden
nur aus den Basis-Tokens gebildet (`var(--tt-…)`, `color-mix(in srgb, var(--tt-…) n%, transparent)`),
nie aus eigenen Farbliteralen.

Schriften, gebündelt über `@fontsource` (keine Anfragen an fremde Origins, CON-0003 UI-04):
Space Grotesk (Überschriften), Inter (Fließtext, Bedienung), JetBrains Mono (Tokens, Zahlen,
Tensorformen, Labels in Versalien).

Gestaltungsregeln:

1. **Licht = aktiv.** Glow (`box-shadow`) und Aurora-Band nur für das, was der Playback-Cursor
   zeigt oder die Primäraktion ist. Höchstens ein Aurora-Band pro Ansicht.
2. **Daten vor Deko.** Heatmaps und Balken nutzen ausschließlich `--tt-gradient-data`; heller
   bedeutet immer „mehr“.
3. **Lesbar am Beamer.** Text auf seinem Grund mindestens 4.5:1, Fließtext ≥ 16 px,
   Bedienelemente ≥ 44 px hoch.
4. **Cyberpunk-Akzente** nur als dünne Linien, Eckmarken an der aktiven Station und Mono-Labels
   in Versalien – keine Glitch- oder Scanline-Effekte.
5. **Bewegung respektiert `prefers-reduced-motion`:** Übergänge und Glow-Animationen entfallen.
6. Nur Dark Mode; ein Hell-Modus ist bewusst nicht vorgesehen.
7. **Akzente als Textfarbe** (Mint, Cyan, Fehler) nur auf `bg`, `surface` und `surface-2`;
   Blau, Tiefblau und Violett nie als Textfarbe (nur Linien, Balken, Schimmer).

## Konsequenzen

**Positiv:**

- Einheitlicher Look für alle Folgespecs; Tokens sind zentral und testbar (Kontrast).
- Bedeutung über Licht unterstützt das Erklären („wo sind wir gerade?“).

**Negativ:**

- Drei gebündelte Schriftfamilien vergrößern den Build (~300 KB woff2).
- Kein Hell-Modus für helle Räume; Beamer-Kontrast muss über Token-Werte gesichert werden.

**Neutral:**

- Die Tokens liegen in `src/app/theme/`; Views nutzen nur die CSS-Variablen, nie Hex-Werte.

## Verknüpfungen

- SPEC-0002 (Playback-Controller) wendet das Theme erstmals an.
- `.sdd/docs/architecture/vision.md`
