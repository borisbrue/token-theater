---
id: SPEC-0013
title: "Mobile layout and touch"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-23
updated: 2026-10-23
version: 0.1.2
priority: high          # low | medium | high | critical
tags: [layout, mobile, touch, theme]
depends_on: ["SPEC-0002", "SPEC-0007", "SPEC-0009", "SPEC-0010", "SPEC-0012"]
contracts: ["CON-0027", "CON-0028"]
tests: ["TST-0031", "TST-0032"]
fr_test_map:
  FR-01: [TST-0032]
  FR-02: [TST-0032]
  FR-03: [TST-0032]
  FR-04: [TST-0032]
  FR-05: [TST-0031, TST-0032]
  FR-06: [TST-0032]
  FR-07: [TST-0032]
  FR-08: [TST-0032]
  FR-09: [TST-0032]
---

# Mobile layout and touch

> **Status:** implemented · **Owner:** Boris · **Version:** 0.1.2
> Grundlage: Wunsch von Boris nach SPEC-0012: „lass uns noch eine mobile Optimierung machen,
> damit man das Theater auch auf dem Smartphone nutzen kann“.

## 1. Kontext & Motivation

Seit SPEC-0012 ist Token Theater öffentlich unter GitHub Pages erreichbar, und viele Besuche
kommen vom Smartphone. Dort ist die App heute kaum benutzbar (gemessen mit 390 × 844, Touch):

- Die Seite ist 562 px breit statt 390 px: Die Gruppe „Engine“ bricht nicht um, weil ein
  `fieldset` standardmäßig `min-width: min-content` hat. Der Browser verkleinert dann die ganze
  Seite.
- Das Formular zerfällt: Die zweispaltige Steuerung lässt Prompt und Max. Tokens auf
  Daumenbreite schrumpfen, das Sampling-Feld liegt über „Erzeugen“ (ein Tipp trifft das Feld).
- Die Knöpfe der Gruppe „Ansicht“ schneiden ihre Beschriftung ab.
- Die Transportleiste steht unter der Station; zum Weiterschalten muss man jedes Mal scrollen.
- Werte in Heatmap und Vektorstreifen erscheinen nur bei Mausbewegung; die Kurzbefehle gelten nur
  für Tastaturen.
- Die Erklärung eines Begriffs kann rechts aus dem Bild ragen.

## 2. Zielsetzung

### Erfolgskriterien

- Bei 360 × 740 und 390 × 844 ist in keiner Ansicht die Seite breiter als das Fenster; breite
  Tabellen und Heatmaps scrollen in ihrem eigenen Container.
- Ein Lauf lässt sich auf dem Smartphone ohne Zoomen erzeugen, abspielen und Station für Station
  durchgehen: per fixierter Transportleiste oder per Wischen über die Station.
- Jedes Bedienelement außer Begriffen im Fließtext ist bei grobem Zeiger mindestens 44 × 44 px
  groß.
- Die Bühne (Präsentation) passt im Hoch- und im Querformat ohne Seitenscrollen ins Fenster.
- Auf dem Desktop bleibt alles, wie es ist: alle bestehenden Tests bleiben grün.

### Nicht-Ziele

- Eigene App, PWA mit Offline-Modus oder Installationsbanner.
- Neue Funktionen nur für Mobilgeräte (außer Wischen und Tippen statt Hover).
- Kleinere GPT-2-Gewichte für Mobilfunk (der Download von distilgpt2 bleibt 353 MB).
- Tablets eigens gestalten: Sie bekommen das Desktop-Layout oder das schmale, je nach Breite.

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

| Schicht | Änderung |
|---|---|
| `src/app/theme/` | `narrow.css` (schmales Fenster) und `touch.css` (grober Zeiger), zuletzt importiert |
| `src/app/player/` | `swipe.ts` (reine Funktion `swipeCommand`) und Hook `use-swipe.ts` |
| `src/views/tensor/` | Heatmap und Vektorstreifen reagieren auf Pointer statt Maus |
| `index.html` | `viewport-fit=cover` für die sichere Zone am unteren Rand |

Zwei Bedingungen steuern die Regeln:

- **schmal:** `@media (max-width: 640px)`.
- **grober Zeiger:** `@media (pointer: coarse)`.

Desktop-Regeln bleiben unverändert; `narrow.css` und `touch.css` überschreiben nur innerhalb ihrer
Bedingung, je Achse eine Datei (Tablet: breit mit Touch; schmales Desktop-Fenster: schmal mit Maus).

### 3.2 Layout bei schmalem Fenster

- `fieldset` hat überall `min-width: 0`; Radio-Reihen (Engine, Strategie) brechen um.
- Steuerung (`.controls`) einspaltig: jedes Label über seinem Feld, Felder in voller Breite; die
  Knöpfe „Erzeugen“, „Trace exportieren“, „Präsentation“ und die Datei-Eingaben untereinander.
  Das Sampling-Feld bleibt dreispaltig (Label, Regler, Wert), mit `minmax(0, 1fr)` für den Regler.
- Gruppe „Ansicht“: Knöpfe brechen um, keiner schneidet seine Beschriftung ab.
- Überschrift `h1` 30 px statt 40 px, Seitenabstand 16 px.
- Breite Tabellen (Routing, Vergleich, Sonde) scrollen in ihrem eigenen Container
  (`overflow-x: auto`); die Heatmap passt sich schon der Breite an (höchstens 100 %). Datei-Eingaben
  sind höchstens so breit wie ihr Container; Grids mit breiten Tabellen haben
  `minmax(0, 1fr)`-Spalten.
- Transportleiste: Die Knöpfe der Transportleiste (`.transport-buttons`) sind im Modus „Erkunden“
  unten am Fenster fixiert (`position: fixed`, volle Breite, Abstand
  `env(safe-area-inset-bottom)`); die Seite bekommt unten so viel Abstand, dass nichts darunter
  verschwindet. Tempo, Zeitleiste und Stationsleiste bleiben an ihrem Platz.

### 3.3 Touch (grober Zeiger)

- Knöpfe, Radio-Chips, Tempo-, Zeitleisten- und Stationsknöpfe: mindestens 44 × 44 px.
  Ausgenommen sind Begriffe im Fließtext (`button.term` außerhalb von Listen „Begriffe“) und die
  Datei-Eingaben des Browsers.
- Kurzbefehle (`.shortcuts`) sind ausgeblendet, sie gelten nur mit Tastatur.
- **Wischen** über die Station (`.station-view`, auch auf der Bühne): nach links → nächste
  Station, nach rechts → vorige (wie → und ←). Regeln in `swipeCommand` (CON-0028, rein, ohne
  DOM). Ein Wisch, der in einem Eingabefeld beginnt oder in einem Element, das die Geste selbst
  braucht und sich dafür mit `data-swipe="ignore"` markiert (Canvas von Heatmap und
  Vektorstreifen, eigene Scroll-Container der Tabellen), zählt nicht (`swipeIgnored`). Neue Ansichten mit eigener Geste
  markieren sich selbst; die Wisch-Regeln bleiben unverändert.
  `.station-view` hat bei grobem Zeiger `touch-action: pan-y`, damit senkrechtes Scrollen beim
  Browser bleibt.
- **Tippen statt Hover:** Heatmap und Vektorstreifen werten `pointerdown` und `pointermove` aus;
  ein Tipp zeigt in `.readout` denselben Text wie die Maus an dieser Stelle. `pointerleave`
  löscht die Anzeige nur bei der Maus, nach einem Tipp bleibt sie stehen.
- **Begriffe als Blatt:** Bei schmalem Fenster erscheint die Erklärung eines Begriffs als Blatt
  am unteren Rand (`position: fixed`, links und rechts 16 px, über der Transportleiste), immer
  ganz im Fenster.

### 3.4 Bühne

Die Bühne nutzt `100dvh`. Bei schmalem Fenster oder niedriger Höhe (`max-height: 500px`)
schrumpfen Kopfzeile und Transportleiste (Kurzbefehle aus, Tempo und Stationsleiste bleiben); die
Station scrollt in sich. Im Hochformat (390 × 844) und im Querformat (844 × 390) ist die Seite
nicht höher als das Fenster, und Stationsüberschrift und Transportknöpfe liegen ganz im Fenster.

### 3.5 Patterns

- **Command** (fortgeführt, SPEC-0002): Ein Wisch wird auf dieselben Playback-Kommandos `next`
  und `prev` abgebildet wie die Pfeiltasten; der Controller bleibt unverändert.
  https://refactoring.guru/design-patterns/command
- **Chain of Responsibility** (fortgeführt, SPEC-0010): Ein Element mit eigener Geste
  (`data-swipe="ignore"`) oder ein Eingabefeld behält den Wisch; nur sonst geht er an den Player.
  https://refactoring.guru/design-patterns/chain-of-responsibility

## 4. Funktionale Anforderungen

| ID | Anforderung |
|---|---|
| FR-01 | Keine waagerecht überlaufende Seite bei 360 und 390 px in allen Ansichten; breite Inhalte in eigenen Scroll-Containern (§3.2). |
| FR-02 | Einspaltige Steuerung, umbrechende Radio-Reihen und Ansicht-Knöpfe; „Erzeugen“ ist antippbar (§3.2). |
| FR-03 | Transportknöpfe unten fixiert im Modus „Erkunden“, ohne Inhalt zu verdecken (§3.2). |
| FR-04 | Touch-Ziele ≥ 44 × 44 px, Kurzbefehle bei grobem Zeiger ausgeblendet (§3.3). |
| FR-05 | Wischen über die Station schaltet Stationen (§3.3, CON-0028). |
| FR-06 | Tippen zeigt Werte in Heatmap und Vektorstreifen (§3.3). |
| FR-07 | Begriffserklärung als Blatt am unteren Rand, ganz im Fenster (§3.3). |
| FR-08 | Bühne passt im Hoch- und Querformat (§3.4). |
| FR-09 | Desktop unverändert: alle bisherigen Tests grün. |

## 5. User Stories

- Als Besucher/in der öffentlichen Seite öffne ich Token Theater auf dem Handy, erzeuge einen
  Mock-Lauf und wische mich durch die Stationen.
- Als Vortragende/r zeige ich die Bühne im Querformat auf dem Handy oder Tablet, ohne dass etwas
  abgeschnitten ist.
- Als Lernende/r tippe ich auf eine Zelle der Attention-Heatmap und sehe ihren Wert.

## 6. Nicht-funktionale Anforderungen

- Keine neue Abhängigkeit; nur CSS und kleine Hooks.
- Wischen reagiert ohne Verzögerung (kein Warten auf Doppeltipp: `touch-action` statt Timer).
- Barrierefreiheit: Alle Funktionen bleiben auch ohne Wischen über Knöpfe erreichbar.

## 7. Akzeptanzkriterien (Gherkin)

Verbindlich sind die Szenarien in CON-0027 (`mobile-ui.feature`); Kurzform:

```gherkin
Szenario: Keine waagerechte Seite
  Angenommen das Fenster ist 390 × 844 groß mit Touch
  Dann ist in keiner Ansicht die Seite breiter als das Fenster

Szenario: Wischen über die Station
  Angenommen ein Mock-Lauf auf dem Smartphone
  Wenn ich über die Station nach links wische
  Dann zeigt die App die nächste Station
```

## 8. Edge Cases & Fehlerfälle

- Senkrechtes Scrollen mit leichtem Seitwärtsanteil schaltet nicht (Verhältnis 2 : 1).
- Wisch auf der letzten Station: Kommando `next` wie die Pfeiltaste, der Controller bleibt stehen.
- Langsamer Zug (> 800 ms) ist kein Wisch.
- Wisch in der Routing-Tabelle (eigener Scroll-Container) scrollt die Tabelle, nicht die Station.
- Bildschirm drehen: Layout folgt ohne Neuladen.

## 9. Contracts (was wird garantiert)

| Contract | Typ | Inhalt |
|---|---|---|
| CON-0027 | behavior (Gherkin) | Mobiles Layout, Touch, Bühne (`mobile-ui.feature`) |
| CON-0028 | behavior (Markdown) | Regeln von `swipeCommand` (`swipe-rules.md`) |

## 10. Tests (wie wird verifiziert)

| Test | Datei | Contract |
|---|---|---|
| TST-0031 | `tests/unit/swipe.test.ts` | CON-0028 |
| TST-0032 | `tests/e2e/mobile.spec.ts` | CON-0027 |

## 11. Implementierungsreihenfolge

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Wisch-Regeln `swipeCommand` | FR-05 | `tests/unit/swipe.test.ts` | `src/app/player/swipe.ts` |
| 2 | Mobiles Layout, Touch, Wisch-Hook, Bühne | FR-01–FR-09 | `tests/e2e/mobile.spec.ts` | `src/**`, `index.html` |

## 12. Offene Fragen

Keine: Rahmen (Breiten 360–430 px, Wischen, fixierte Transportleiste, Desktop unverändert) aus
Boris' Wunsch abgeleitet.

## 13. Änderungshistorie

| Datum | Version | Änderung |
|---|---|---|
| 2026-10-23 | 0.1.0 | Entwurf nach Messung bei 390 × 844 |
| 2026-10-23 | 0.1.1 | Review: Ausnahmen per `data-swipe="ignore"` (OCP), CSS je Achse getrennt (SRP) |
| 2026-10-23 | 0.1.2 | Implementiert (Run SPEC-0013-20261023T204826-639a3a); Bühne im Querformat mit zwei Steuerzeilen, Tempo kompakt |
