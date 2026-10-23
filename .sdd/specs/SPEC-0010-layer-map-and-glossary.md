---
id: SPEC-0010
title: "Layer map and glossary"
type: feature           # feature | bug-fix
status: implemented           # draft | review | approved | implemented | deprecated
owner: "Boris"
created: 2026-10-22
updated: 2026-10-22
version: 0.2.1
priority: high          # low | medium | high | critical
tags: [ui, explanations, glossary, layers]
depends_on: ["SPEC-0007", "SPEC-0009"]
contracts: ["CON-0021"]
tests: ["TST-0023"]
fr_test_map:
  FR-01: [TST-0023]
  FR-02: [TST-0023]
  FR-03: [TST-0023]
  FR-04: [TST-0023]
  FR-05: [TST-0023]
  FR-06: [TST-0023]
  FR-07: [TST-0023]
  FR-08: [TST-0023]
---

# Layer map and glossary

> **Status:** implemented · **Owner:** Boris · **Version:** 0.2.1
> Grundlage: `.sdd/docs/architecture/vision.md` (Zweck „Selbstlernen“ und „Vortrag/Unterricht“),
> Rückmeldung von Boris nach SPEC-0009: „Können wir die Layer auch noch erklären? Viele Begriffe
> sind unklar in der Verwendung.“

## 1. Kontext & Motivation

Seit SPEC-0009 hat jede Station einen Satz und „Mehr dazu“. Zwei Lücken bleiben:

- **Was ein Layer ist, steht nirgends.** Die Stationen heißen „attention · Layer 0“,
  „residual · Layer 0 · nach Attention“, „mlp · Layer 0“, „residual · Layer 0 · nach MLP“, dann
  dasselbe mit Layer 1. Dass diese vier Stationen zusammen einen Block bilden, dass das Modell
  diesen Block n-mal mit eigenen Gewichten stapelt und wo man gerade in diesem Stapel steht,
  erschließt sich nur aus der Stationsleiste (TOK EMB A0 R M0 R A1 R …).
- **Fachbegriffe werden benutzt, aber nicht erklärt.** Die Ansichten zeigen Tensor, Vektor,
  Dimension, Kopf, Mittel, maskiert, KV-Cache, ‖v‖, Δ, Hidden, Neuron, „Aktiv (> 0)“, Logit,
  Logit-Lens, Kandidaten, Seed, Top-k, Top-p, lnIn, q/k/v. Die Erklärtexte nennen Residual
  Stream, Softmax, GELU, Query/Key/Value, kausale Maske. Wer das nicht schon weiß, sieht Wörter,
  aber nicht, was sie in dieser Ansicht bedeuten.

## 2. Zielsetzung

**Primärziel:** Jede Station zeigt, wo sie im Modell liegt (Layer-Karte), und jeder Fachbegriff,
den die App benutzt, lässt sich an Ort und Stelle nachschlagen: was er bedeutet und wo man ihn in
der App sieht. Eine Glossar-Ansicht listet alle Begriffe.

**Erfolgskriterien (messbar):**
- [ ] Jede Station eines Laufs mit Interna zeigt eine Layer-Karte mit allen Stationen des Schritts, gruppiert in Eingabe, Layer 0 … n−1 und Ausgabe; die aktuelle Station ist markiert, eine Zeile darunter sagt, welcher Teil des Layers sie ist.
- [ ] Das Glossar hat genau die 33 Begriffe aus §3.4, jeder mit Bedeutung und „In der App“.
- [ ] Jede Station zeigt eine Liste „Begriffe“ (§3.5); jeder Eintrag öffnet seine Erklärung an Ort und Stelle.
- [ ] Die Erklärsätze und „Mehr dazu“ markieren die Begriffe aus §3.6; ihr Text bleibt Wort für Wort gleich (CON-0020 bleibt erfüllt).
- [ ] Eine Ansicht „Glossar“ neben „Durchlauf“ und „Tokenizer“ listet alle Begriffe alphabetisch.
- [ ] Erklärungen lassen sich mit Maus und Tastatur öffnen und schließen; `Esc` schließt erst die Erklärung, nicht den Präsentationsmodus.
- [ ] Auf der Bühne (1280 × 720) passen Tokenstrom, Stationsüberschrift und Transportleiste weiter ohne Seiten-Scrollen ins Fenster.

**Nicht-Ziele:**
- Navigation über die Layer-Karte: Sie zeigt nur an, springen geht weiter über die
  Stationsleiste und die Tasten.
- Begriffe in den Beschriftungen der Ansichten selbst markieren (Achsen, Legenden, Radiogruppen):
  Die Liste „Begriffe“ je Station deckt sie ab, ohne die Renderer aus SPEC-0003/0004/0007 und
  ihre Tests zu ändern.
- Links aus einer Erklärung in die Glossar-Ansicht, Suche im Glossar.
- Geführte Tour, Animation zwischen Layern, Erklärung einzelner Gewichte oder Neuronen.
- Mehrsprachigkeit: Die Texte bleiben Deutsch.

## 3. Architektur-Entscheidungen & Design Patterns

### 3.1 Schichtung

```
src/views/glossary/types.ts         TermId, GlossaryEntry, Glossary
src/views/glossary/term-markup.ts   parseTerms(text) → Segmente (Text | Begriff)
src/views/glossary/Term.tsx         Begriff-Knopf mit Erklärung (Disclosure)
src/views/glossary/term-keys.ts     termCommandForKey(key, open)
src/views/glossary/TermText.tsx     Text mit markierten Begriffen
src/views/glossary/GlossaryView.tsx Ansicht „Glossar“
src/views/station/layer-map.ts      layerMap(stations, current) → Gruppen und Teil im Layer
src/views/station/LayerMap.tsx      Layer-Karte und Zeile zum Teil im Layer
src/views/station/StationView.tsx   Layer-Karte, TermText für Satz und „Mehr dazu“, Liste „Begriffe“
src/app/glossary-texts.ts           die 33 Glossar-Einträge und die Begriffe je Station
src/app/texts.ts                    Markierungen in den Sätzen, Layer-Texte; bindet glossary-texts als texts.glossary
src/app/App.tsx                     Ansicht „Glossar“
src/app/theme/glossary.css          Begriffe, Erklärung, Layer-Karte (nur var(--tt-…))
```

`src/views` importiert weiter nichts aus `src/app` oder `src/engine` (CON-0004). Die Texte des
Glossars stehen in `src/app/glossary-texts.ts` (eigener Änderungsgrund: Redaktion des Glossars),
`texts.ts` reicht sie als `texts.glossary` weiter; sie kommen als Labels in die Views, wie die Renderer-Texte
seit SPEC-0003. Muster: [Factory Method](https://refactoring.guru/design-patterns/factory-method)
wie bisher: Die App bindet die Texte, die Views bekommen fertige Daten.

### 3.2 Layer-Karte

Eine reine Funktion `layerMap(stations, currentIndex)` in `src/views/station/layer-map.ts`
gruppiert die Stationen des aktuellen Schritts:

- **Eingabe:** alle Stationen vor der ersten Station mit `layer` (tokenize, embed).
- **Layer l:** alle Stationen mit `layer === l`, in Trace-Reihenfolge (attention, residual nach
  Attention, mlp, residual nach MLP).
- **Ausgabe:** alle Stationen nach der letzten Station mit `layer` (logits, sample).

Die Kurztexte der Kästchen stehen in `layer-map.ts` als `Record<StationKind, string>`
(`TOK`, `EMB`, `A`, `+`, `M`, `LOG`, `SMP`; residual ist `+`). Weil `StationKind` eine
geschlossene Union des Trace-Formats ist, erzwingt eine neue Stationsart dort und in den Texten
einen Typfehler statt eines stillen Fallbacks; die Gruppierung selbst hängt nur an `layer`.

Sie liefert die Gruppen und für die aktuelle Station `{ layer, part, parts }` (Teil `part` von
`parts` im Layer, ab 1 gezählt) oder `null` außerhalb der Layer. Die Zahl der Layer kommt aus den
Stationen, nicht aus `architecture`; so funktioniert die Karte auch bei importierten Traces ohne
Architektur. Hat der Schritt keine Station mit `layer` (Server-Lauf), gibt es keine Karte.

Darstellung (`LayerMap.tsx`) im Kopf der Station, rechts neben der Position:

```
<div class="station-head">
  <p class="label station-position">Schritt 0 · Station 3 / 12</p>
  <ol class="layer-map" aria-label="Layer-Karte">
    <li aria-label="Eingabe"><ol><li aria-label="tokenize">TOK</li><li aria-label="embed">EMB</li></ol></li>
    <li aria-label="Layer 0"><ol><li aria-label="attention · Layer 0" aria-current="step">A</li> … </ol></li>
    …
    <li aria-label="Ausgabe">…</li>
  </ol>
</div>
<h2>attention · Layer 0</h2>
<p class="explanation">…</p>                    (bleibt direkt unter h2, CON-0020)
<details class="explanation-more">…</details>
<p class="layer-part">Layer 0 · Teil 1 von 4: Die Attention holt Information von früheren Tokens.</p>
<ul class="term-list" aria-label="Begriffe">…</ul>
```

- Jede Gruppe ist ein `<li>` mit `aria-label` (Eingabe, „Layer l“, Ausgabe) und sichtbarem
  Kurztext (`E`, `L0`, `L1`, …, `A`); darin je Station ein Kästchen mit `aria-label` =
  Stationsname (CON-0006) und Kurztext `TOK`, `EMB`, `A`, `+`, `M`, `+`, `LOG`, `SMP`.
- Die aktuelle Station hat `aria-current="step"`, ihre Gruppe die Klasse `current`.
- Die Zeile `layer-part` steht unter „Mehr dazu“ und nennt den Teil (§3.3); sie enthält den
  markierten Begriff „Layer“ (§3.6).
- Die Karte ist eine Anzeige ohne Knöpfe. Bei 12 Layern (gpt2) passt sie in eine Zeile von
  ≤ 640 px; sonst bricht der Kopf um.

### 3.3 Texte zum Teil im Layer

| Station | Zeile `layer-part` |
|---|---|
| tokenize, embed | `Vor den [[layer\|Layern]]: Der Text wird zu Vektoren.` |
| attention | `[[layer\|Layer]] l · Teil i von n: Die Attention holt Information von früheren Tokens.` |
| residual nach Attention | `[[layer\|Layer]] l · Teil i von n: Ihr Ergebnis wird zum Residual Stream addiert.` |
| mlp | `[[layer\|Layer]] l · Teil i von n: Das MLP verarbeitet jedes Token für sich.` |
| residual nach MLP | `[[layer\|Layer]] l · Teil i von n: Sein Ergebnis wird addiert; der Layer ist fertig.` |
| logits, sample | `Nach den [[layer\|Layern]]: Aus dem letzten Vektor wird das nächste Token.` |

Die Zeile erzeugt eine Funktion der App,
`layerPart(station: Station, place: { layer, part, parts } | null) => string` in den Labels von
`StationView` ([Factory Method](https://refactoring.guru/design-patterns/factory-method)); `LayerMap`
enthält keinen Text. Ohne Karte (Schritt ohne Layer-Stationen) entfällt auch die Zeile.

### 3.4 Glossar

`Glossary = Readonly<Record<TermId, GlossaryEntry>>`,
`GlossaryEntry = { term: string; meaning: string; inApp: string }`. Die Texte sind verbindlich:

| TermId | term | meaning | inApp |
|---|---|---|---|
| token | Token | Ein Stück Text mit fester Nummer: ein Wort, ein Wortteil oder ein Satzzeichen. Das Modell sieht nur diese Nummern, nie einzelne Buchstaben. | Die Kästchen im Tokenstrom; „␣“ steht für ein Leerzeichen am Anfang des Tokens. |
| vocabulary | Vokabular | Die feste Liste aller Tokens, die ein Modell kennt; GPT-2 kennt 50.257. | Die Nummer neben jedem Token und die Kandidaten der logits-Station. |
| bpe | BPE | Byte-Pair-Encoding: Der Text wird in Bytes zerlegt, dann werden benachbarte Stücke nach einer gelernten Rangliste verschmolzen. Häufige Wörter werden so ein Token, seltene mehrere. | Die Ansicht „Tokenizer“ zeigt jeden Merge-Schritt. |
| vector | Vektor | Eine Liste von Zahlen fester Länge. Damit rechnet das Modell: Jedes Token ist an jeder Stelle ein Vektor. | Die farbigen Streifen, ein Feld je Zahl. |
| dimension | Dimension | Eine einzelne Zahl in einem Vektor, gezählt ab 0. Eine Dimension allein bedeutet meist nichts Greifbares; erst das Muster vieler Zahlen trägt Bedeutung. | Zeige auf ein Feld eines Streifens, um Dimension und Wert zu sehen. |
| tensor | Tensor | Ein Block von Zahlen mit einer Form, etwa [6, 768] für 6 Tokens mit je 768 Zahlen. | Die Liste „Tensoren“ nennt die Formen einer Station. |
| embedding | Embedding | Der Vektor, mit dem ein Token ins Modell kommt: eine gelernte Zeile je Token, dazu eine gelernte Zeile je Position (Positions-Embedding). | Die embed-Station zeigt beide und ihre Summe. |
| layer | Layer | Ein Block aus Attention und MLP; beide addieren ihr Ergebnis zum Residual Stream. Das Modell stapelt mehrere gleich gebaute Layer mit eigenen Gewichten, jeder arbeitet mit dem Ergebnis des vorigen. Frühe Layer erfassen eher Wortformen und Nachbarschaft, späte eher Bedeutung und die nächste Vorhersage. | Jeder Layer hat vier Stationen: attention, residual, mlp, residual. Die Layer-Karte zeigt, wo du bist. |
| attention | Attention | Der Teil eines Layers, in dem Tokens Information voneinander übernehmen. Jedes Token gewichtet die Tokens bis zu sich selbst und mischt ihre Inhalte. | Die Heatmap: eine Zeile je Token, eine Spalte je Token, auf das es schaut. |
| head | Kopf | Eine von mehreren parallelen Attention-Rechnungen in einem Layer. Jeder Kopf hat eigene Gewichte und achtet auf etwas anderes, etwa auf das vorige Wort. | Wähle einen Kopf oder „Mittel“, den Durchschnitt aller Köpfe. |
| qkv | Query, Key, Value | Drei Vektoren, die jedes Token in der Attention bildet: was es sucht (Query), wofür es steht (Key) und was es weitergibt (Value). Passen Query und Key gut zusammen, fließt viel von diesem Value. | Die Tensoren q, k und v der attention-Station. |
| mask | Kausale Maske | Sperrt in der Attention alle späteren Tokens. So kann das Modell beim Vorhersagen nicht in die Zukunft schauen. | Die leeren Felder oben rechts in der Heatmap („maskiert“). |
| kvCache | KV-Cache | Keys und Values früherer Tokens bleiben gespeichert. Ein neuer Schritt rechnet deshalb nur die Zeile des neuen Tokens. | „Frühere Schritte zeigen“ blendet die gespeicherten Zeilen ein. |
| residual | Residual Stream | Der Vektor je Token, der von Layer zu Layer weitergereicht wird. Attention und MLP addieren ihr Ergebnis dazu, statt ihn zu ersetzen. | Die residual-Stationen und der „Verlauf“ seiner Länge über die Layer. |
| layerNorm | LayerNorm | Bringt einen Vektor vor Attention und MLP auf einen einheitlichen Maßstab (Mittelwert 0, Streuung 1) und skaliert ihn dann mit gelernten Zahlen. | Der Tensor lnIn. |
| norm | Norm | Die Länge eines Vektors: die Wurzel aus der Summe der Quadrate seiner Zahlen. Sie sagt, wie stark ein Vektor ist, nicht wohin er zeigt. | ‖v‖ und ‖x‖ an den Streifen und im Verlauf; Δ ist die Änderung gegenüber dem vorigen Wert. |
| mlp | MLP | Multi-Layer Perceptron, der zweite Teil eines Layers: ein kleines Netz, das jedes Token für sich verarbeitet. Es vergrößert den Vektor, wendet GELU an und verkleinert ihn wieder. | Die mlp-Station mit Eingang, Hidden und Ausgang. |
| hidden | Hidden | Die breite Mitte des MLP, bei GPT-2 viermal so breit wie der Residual Stream. Jede Zahl darin gehört zu einem Neuron. | Der breite Streifen der mlp-Station. |
| neuron | Neuron | Eine Zahl in der Mitte des MLP. Ist sie groß, „feuert“ das Neuron; manche Neuronen reagieren auf erkennbare Muster im Text. | „Stärkste Neuronen“ und „Aktiv (> 0)“, die Zahl der Neuronen über 0. |
| gelu | GELU | Die Nichtlinearität im MLP: Positive Werte gehen fast unverändert durch, negative werden gegen 0 gedrückt. Ohne sie wäre das MLP nur eine einzige lineare Rechnung. | Wirkt in der mlp-Station zwischen Eingang und Ausgang. |
| logit | Logit | Die rohe Bewertung eines Tokens als nächstes Token, eine Zahl je Token im Vokabular. Höher heißt wahrscheinlicher; Logits dürfen negativ sein. | Die Spalte neben der Wahrscheinlichkeit in der logits-Station. |
| softmax | Softmax | Macht aus Logits Wahrscheinlichkeiten: Jede Bewertung wird exponentiert und durch die Summe aller geteilt, zusammen ergeben sie 100 %. | Die Prozentwerte der Kandidaten. |
| logitLens | Logit-Lens | Wendet die Ausgabe des Modells schon auf einen Zwischenstand des Residual Stream an. So sieht man, welches Token das Modell nach diesem Layer vorhersagen würde. | Die residual-Stationen nach dem MLP, für die letzte Position. |
| candidate | Kandidat | Ein mögliches nächstes Token mit seiner Wahrscheinlichkeit. | Die Listen der logits- und sample-Station; ein Server liefert nur die besten Kandidaten. |
| sampling | Sampling | Die Wahl des nächsten Tokens aus den Wahrscheinlichkeiten. | Die Einstellungen „Sampling“ im Formular, das Ergebnis in der sample-Station, zum Ausprobieren das Sampling-Labor. |
| greedy | Greedy | Nimmt immer das wahrscheinlichste Token, ohne Zufall. Derselbe Prompt ergibt denselben Text. | Die Einstellung „Greedy“ im Formular. |
| temperature | Temperatur | Teilt die Logits vor Softmax. Unter 1 wird die Verteilung spitzer, über 1 flacher und der Text überraschender. | Die Felder „Temperatur“ im Formular und im Sampling-Labor. |
| topK | Top-k | Behält nur die k wahrscheinlichsten Tokens und verteilt die Wahrscheinlichkeit unter ihnen neu; 0 heißt aus. | Die Felder „Top-k“; entfernte Tokens sind im Labor markiert. |
| topP | Top-p | Behält die kleinste Gruppe der besten Tokens, die zusammen mindestens p erreichen; 1 heißt aus. | Die Felder „Top-p“ im Formular und im Sampling-Labor. |
| seed | Seed | Der Startwert des Zufallsgenerators. Derselbe Seed ergibt dieselben Zufallszahlen und damit denselben Text. | Das Feld „Seed“ und die Zufallszahl in der sample-Station. |
| trace | Trace | Die Aufzeichnung eines Laufs mit allen Zwischenwerten. Die App spielt ihn nur ab und rechnet dabei nichts neu. | „Trace exportieren“ speichert ihn als JSON, „Trace importieren“ lädt ihn wieder. |
| step | Schritt | Ein Durchgang durch das Modell, der genau ein neues Token erzeugt. Schritt 0 verarbeitet den ganzen Prompt. | Die Zeitleiste hat einen Knopf je Schritt. |
| station | Station | Ein Halt innerhalb eines Schritts: tokenize, embed, je Layer attention, residual, mlp, residual, dann logits und sample. | Die Stationsleiste und die Position „Station i / n“. |

### 3.5 Begriffe je Station

Unter der Zeile `layer-part` zeigt jede Station `<ul class="term-list" aria-label="Begriffe">`
mit einem Begriff-Knopf (§3.7) je Eintrag, in dieser Reihenfolge:

| Station | Begriffe |
|---|---|
| tokenize | token, bpe, vocabulary, trace, step, station |
| embed | embedding, vector, dimension, tensor |
| attention | attention, head, qkv, mask, kvCache, layerNorm |
| residual | residual, layer, norm, logitLens |
| mlp | mlp, hidden, neuron, gelu, layerNorm |
| logits | logit, softmax, candidate, vocabulary |
| sample | sampling, greedy, temperature, topK, topP, seed |

Jeder der 33 Begriffe kommt in mindestens einer Liste vor. Die Zuordnung ist ein Label
(`texts.glossary.byStation: Record<StationKind, readonly TermId[]>` aus `glossary-texts.ts`),
keine Logik in den Views.

### 3.6 Markierte Begriffe in den Texten

Texte markieren Begriffe mit `[[id|Anzeige]]` (Anzeige ist das Wort im Satz, auch gebeugt) oder
`[[id]]` (Anzeige = `term`). `parseTerms(text)` in `src/views/glossary/term-markup.ts` zerlegt
einen Text in Segmente `{ kind: 'text', text }` und `{ kind: 'term', id, text }`; eine
unvollständige Markierung (`[[` ohne `]]`) bleibt Text. `TermText` rendert die Segmente, Begriffe
als Knopf (§3.7); eine `id`, die das Glossar nicht kennt, erscheint als reiner Text.

**Der sichtbare Text ändert sich nicht:** Ohne die Klammern ist jeder Satz Wort für Wort der
bisherige (CON-0020, `h2 + p` bleibt der Erklärsatz). Markiert wird höchstens das erste
Vorkommen eines Begriffs je Text:

| Text | Markierungen |
|---|---|
| Satz tokenize | `Tokens` → token |
| Satz embed | `Zahlenvektor` → vector |
| Satz attention | `Kopf` → head |
| Satz residual | `Datenstrom` → residual |
| Satz mlp | `neuronales Netz` → mlp |
| Satz logits | `Vokabular` → vocabulary, `Bewertung` → logit |
| Satz sample | `Wahrscheinlichkeiten` → softmax |
| Mehr dazu tokenize | `Byte-Pair-Encoding` → bpe |
| Mehr dazu embed | `Token-Embedding` → embedding, `Residual Stream` → residual |
| Mehr dazu attention | `Query` → qkv, `kausale Maske` → mask, `KV-Cache` → kvCache |
| Mehr dazu residual nach Attention | `Residual Stream` → residual, `Layer` → layer |
| Mehr dazu residual nach MLP | `MLP` → mlp, `Logit-Lens` → logitLens |
| Mehr dazu mlp | `GELU` → gelu |
| Mehr dazu logits | `Logit` → logit, `Softmax` → softmax |
| Mehr dazu sample | `Greedy` → greedy, `Temperatur` → temperature, `Top-k` → topK, `Top-p` → topP |

Die Zahlen-Sätze aus SPEC-0009 (`withFacts`) und der logits-Satz ohne Modellzahlen bleiben
unmarkiert; so sind die Markierungen mit und ohne Modellzahlen dieselben.

### 3.7 Begriff-Knopf und Erklärung

`Term` rendert in einem `<span class="term-wrap">`:

- `<button type="button" class="term" aria-expanded="false|true">Anzeige</button>`; der
  zugängliche Name ist der sichtbare Text.
- Geöffnet folgt **neben** dem Knopf (nicht darin)
  `<span role="tooltip" id="…" class="term-popover">` mit `<strong>term</strong>`, Leerzeichen,
  `meaning`, Leerzeichen und `<span class="term-in-app">In der App: inApp</span>` (als eigene
  Zeile dargestellt). Der Text des Elements ist also genau
  `` `${term} ${meaning} In der App: ${inApp}` ``. Der Knopf hat dann `aria-describedby` auf
  diese ID. Geschlossen ist die Erklärung **nicht im DOM**, damit
  Textvergleiche bestehender Tests (Satz, „Mehr dazu“) unverändert bleiben.
- Öffnen: Klick oder Enter/Leertaste auf dem Knopf. Schließen: erneuter Klick, `Esc` auf dem
  Knopf, oder der Knopf verliert den Fokus (Tab, Klick daneben, Öffnen eines anderen Begriffs).
  Ein Klick in die Erklärung lässt sie offen (`pointerdown` dort verhindert den Fokuswechsel).
- Tasten am Knopf übersetzt die reine Funktion `termCommandForKey(key, open)` in
  `src/views/glossary/term-keys.ts` in `'close' | null` (`Escape` nur bei offener Erklärung;
  Enter und Leertaste bleiben das native Klicken des Knopfs),
  [Command](https://refactoring.guru/design-patterns/command) wie `commandForKey` (SPEC-0002) und
  `presentationCommandForKey` (SPEC-0009).
- **Vorrang beim Esc** ([Chain of Responsibility](https://refactoring.guru/design-patterns/chain-of-responsibility)):
  Wer eine Taste konsumiert, ruft `preventDefault()`. Die globalen Tasten-Hooks
  (`usePlaybackKeys`, `usePresentationKeys`) lauschen in der Bubble-Phase auf `document` und
  übergehen Ereignisse mit `defaultPrevented` (so seit SPEC-0002/0009). Der Vorrang hängt damit an
  dieser Regel, nicht an `stopPropagation` oder der DOM-Struktur; `Term` ruft zusätzlich
  `stopPropagation()`. `Esc` bei offener Erklärung schließt nur sie, der Präsentationsmodus bleibt
  an; bei geschlossener Erklärung wirkt `Esc` wie bisher.
- Die Erklärung liegt absolut positioniert unter dem Knopf, höchstens `min(32rem, 90vw)` breit,
  über dem übrigen Inhalt. Farben nur aus dem Theme; auf der Bühne mit der Stationsschrift.

Muster: [State](https://refactoring.guru/design-patterns/state) ist für zwei Zustände (offen,
zu) zu schwer; `Term` hält `open` als React-State. Wiederverwendet wird die Disclosure-Logik
aus SPEC-0009 nicht (`<details>`), weil `<details>` in einem Satz einen Blockumbruch erzwingt.

### 3.8 Ansicht „Glossar“

- Die Gruppe „Ansicht“ (SPEC-0003) bekommt einen dritten Knopf „Glossar“ (`aria-pressed`), auch
  ohne Trace bedienbar. `View` in `App` wird `'run' | 'tokenizer' | 'glossary'`.
- `GlossaryView` rendert `<section aria-label="Glossar">` mit Überschrift „Glossar“, einem Satz
  „Alle Begriffe, die Token Theater benutzt.“ und einer `<dl>`: je Begriff `<dt id="begriff-id">`
  mit `term` und `<dd>` mit zwei Absätzen: `<p>meaning</p><p>In der App: inApp</p>`. Sortiert nach
  `term` mit `localeCompare(…, 'de')`.
- Im Präsentationsmodus gibt es keine Gruppe „Ansicht“ (SPEC-0009), also auch kein Glossar; die
  Begriff-Knöpfe auf der Bühne funktionieren.

### 3.9 Texte und Labels

```ts
texts.glossary = {
  entries: Glossary,                                   // §3.4, aus glossary-texts.ts
  byStation: Record<StationKind, readonly TermId[]>,   // §3.5, aus glossary-texts.ts
  termList: 'Begriffe',
  inApp: 'In der App: ',
  region: 'Glossar',
  heading: 'Glossar',
  intro: 'Alle Begriffe, die Token Theater benutzt.',
}
texts.views.glossary = 'Glossar'
texts.station.layerPart = (station: Station, place: LayerPlace | null) => string   // §3.3
texts.station.explanations / texts.station.more   // wie SPEC-0009, mit Markierungen (§3.6)
texts.layerMap = {
  region: 'Layer-Karte',
  input: 'Eingabe', inputShort: 'E',
  output: 'Ausgabe', outputShort: 'A',
  layer: (l: number) => `Layer ${l}`, layerShort: (l: number) => `L${l}`,
}
```

`LayerPlace = { layer: number; part: number; parts: number }` steht in
`src/views/station/layer-map.ts`, `TermId`, `GlossaryEntry`, `Glossary` in
`src/views/glossary/types.ts`. `parseTerms(text: string): TermSegment[]` mit
`TermSegment = { kind: 'text'; text: string } | { kind: 'term'; id: string; text: string }`.

### 3.10 Festlegungen für die test-first geschriebenen Tests

- Ein Akzeptanztest je Szenario aus `glossary-ui.feature` (CON-0021), Testname =
  Szenariotitel, plus Abgleichtest; GPT-2-Testmodell per `page.route` wie TST-0022.
- Die Vollständigkeit (33 Begriffe, jede Markierung in den Texten bekannt, jeder Begriff in einer
  Liste) prüft die Suite ohne Browser: Sie importiert `texts` aus `src/app/texts.ts` und
  `parseTerms` aus `src/views/glossary/term-markup.ts` und durchläuft alle Erklärsätze,
  `more(station, facts)` für jede Stationsart mit und ohne Modellzahlen und `layerPart`. Die Texte
  vor SPEC-0010 liegen als Referenz in `tests/fixtures/glossary/texts-before-spec-0010.json`.
- DOM: `.layer-map` mit `aria-label="Layer-Karte"`, `aria-current="step"`; `.layer-part`;
  `ul[aria-label="Begriffe"]`; `button.term[aria-expanded]`; `[role="tooltip"]`; Region
  „Glossar“, `dt[id^="begriff-"]`.

## 4. Funktionale Anforderungen

- **FR-01:** Layer-Karte nach 3.2 im Kopf jeder Station mit Layer-Stationen im Schritt; aktuelle Station markiert; keine Karte ohne Layer-Stationen.
- **FR-02:** Zeile zum Teil im Layer nach 3.3 unter „Mehr dazu“, mit markiertem Begriff „Layer“.
- **FR-03:** Glossar mit den 33 Einträgen aus 3.4, wörtlich, in `src/app/texts.ts`.
- **FR-04:** Liste „Begriffe“ je Station nach 3.5.
- **FR-05:** Markierungen nach 3.6 mit `parseTerms` und `TermText`; sichtbarer Text der Sätze unverändert.
- **FR-06:** Begriff-Knopf mit Erklärung nach 3.7, bedienbar mit Maus und Tastatur; `Esc` schließt erst die Erklärung.
- **FR-07:** Ansicht „Glossar“ nach 3.8.
- **FR-08:** Texte in `src/app/texts.ts`, Farben nur aus dem Theme, `src/views` ohne `src/app`/`src/engine`; die Bühne passt bei 1280 × 720 weiter (CON-0020); bestehende Contracts bleiben erfüllt.

## 5. User Stories

| ID    | Als ...        | möchte ich ...                                                     | um ...                                                  |
|-------|----------------|--------------------------------------------------------------------|---------------------------------------------------------|
| US-01 | Lernende/r     | sehen, in welchem Layer und welchem Teil davon ich gerade bin      | den Aufbau des Modells als Stapel gleicher Blöcke zu verstehen |
| US-02 | Lernende/r     | ein unbekanntes Wort anklicken und an Ort und Stelle erklärt bekommen | weiterlesen zu können, ohne die Ansicht zu verlassen    |
| US-03 | Lernende/r     | alle Begriffe an einer Stelle nachlesen                            | mir einen Überblick zu verschaffen                      |
| US-04 | Vortragende/r  | auf der Bühne einen Begriff aufklappen und mit Esc wieder schließen | Fragen aus dem Publikum zu beantworten, ohne die Bühne zu verlassen |

## 6. Nicht-funktionale Anforderungen

| Kategorie        | Anforderung |
|------------------|-------------|
| Bedienbarkeit    | Bühne bei 1280 × 720 ohne Seiten-Scrollen (CON-0020); Layer-Karte bei 12 Layern in einer Zeile ≤ 640 px |
| Barrierefreiheit | Begriffe als Knöpfe mit `aria-expanded`; Erklärung per `aria-describedby`; Karte mit `aria-current="step"` |
| Theme            | Farben nur aus `src/app/theme` (CON-0007 T-03) |
| Architektur      | `src/views` ohne Importe aus `src/app` und `src/engine` (CON-0004) |
| Performance      | Karte und Begriffe aus Daten des Traces, keine Neuberechnung |

## 7. Akzeptanzkriterien (Gherkin)

```gherkin
Feature: Layer-Karte und Glossar

  Scenario: Layer-Karte zeigt die Lage der Station
    Given ein Mock-Lauf
    When ich die Station "attention · Layer 1" wähle
    Then markiert die Layer-Karte das Kästchen "attention · Layer 1"
    And steht darunter "Layer 1 · Teil 1 von 4: Die Attention holt Information von früheren Tokens."

  Scenario: Begriff an Ort und Stelle
    Given ein Mock-Lauf
    When ich die Station "attention · Layer 0" wähle und auf den Begriff "Kopf" klicke
    Then erscheint die Erklärung "Kopf Eine von mehreren parallelen Attention-Rechnungen in einem Layer. …"
```

Die verbindlichen Szenarien stehen im Contract (via /sdd-review).

## 8. Edge Cases & Fehlerfälle

- Server-Lauf ohne Layer-Stationen: keine Karte, keine Zeile `layer-part`; die Liste „Begriffe“
  gibt es trotzdem.
- Importierter Trace ohne Architektur, aber mit Layer-Stationen: Karte aus den Stationen.
- Unbekannte `id` in einer Markierung: Text ohne Knopf; die Testsuite verhindert das für die
  ausgelieferten Texte.
- Zwei Begriffe nacheinander: Das Öffnen des zweiten schließt den ersten (Fokuswechsel).
- Wechsel der Station bei offener Erklärung: Die Station wird neu gerendert, die Erklärung ist zu.
- `Esc` auf der Bühne mit offener Erklärung: Erklärung zu, Bühne bleibt; zweites `Esc` beendet
  die Präsentation.
- Leertaste auf einem Begriff-Knopf öffnet die Erklärung und startet keine Wiedergabe
  (CON-0006 UI-04: Leertaste nicht auf Knöpfen).

## 9. Contracts (was wird garantiert)

| Contract-ID | Typ      | Was wird garantiert? |
|-------------|----------|----------------------|
| CON-0021 | behavior (gherkin) | Layer-Karte und Teil im Layer, Begriffe je Station, Markierungen, Erklärung mit Maus und Tastatur, Esc-Vorrang, Glossar-Ansicht, Vollständigkeit, Bühne in 1280 × 720 |

## 10. Tests (wie wird verifiziert)

| Test-ID  | Level      | Was prüft der Test? |
|----------|------------|---------------------|
| TST-0023 | acceptance | CON-0021, alle Szenarien, GPT-2-Testmodell per `page.route`, Vollständigkeit per Import von `texts` und `parseTerms` |

## 11. Implementierungsreihenfolge

Ein Task, eine Testsuite: Karte, Begriffe und Glossar teilen `StationView`, `texts.ts` und das
Theme; getrennte Suiten würden sich beim GREEN-Gate gegenseitig blockieren (wie SPEC-0009).

| # | Task | FRs | Testdatei (verbindlich) | Pfade |
|---|---|---|---|---|
| 1 | Layer-Karte, Glossar, Begriffe, Markierungen, Ansicht „Glossar“ | FR-01–FR-08 | `tests/e2e/glossary.spec.ts` | `src/app/**`, `src/views/**` |

## 12. Offene Fragen

- [x] Layer-Karte zum Springen nutzen? **Antwort (2026-10-22, autonom entschieden):** nein. Die Stationsleiste springt schon; eine zweite Navigation mit anderer Gruppierung würde Tests und Fokusregeln verdoppeln.
- [x] Begriffe auch in Achsen- und Legendenbeschriftungen markieren? **Antwort (2026-10-22, autonom entschieden):** nein, die Liste „Begriffe“ je Station deckt sie ab; die Renderer und ihre Locators bleiben unverändert.
- [x] Erklärung als Hover-Tooltip? **Antwort (2026-10-22, autonom entschieden):** nein, Klick bzw. Enter: Hover geht auf Touch und mit Clicker nicht, und ein Vortrag braucht eine Erklärung, die stehen bleibt.
- [x] Layer-Zählung ab 0 oder 1? **Antwort (2026-10-22, autonom entschieden):** ab 0 wie in den Stationsnamen und im Trace; die Glossar-Zeile zu „Station“ und der Satz „gezählt ab 0“ (SPEC-0009) sagen es.

## 13. Änderungshistorie

| Datum      | Version | Autor  | Änderung            |
|------------|---------|--------|---------------------|
| 2026-10-22 | 0.1.0   | Boris  | Initiale Erstellung |
| 2026-10-22 | 0.2.0   | Boris  | Review: Glossar in `glossary-texts.ts`, `layerPart` als Label-Funktion, Kurztexte als `Record<StationKind, …>`, Esc-Vorrang über `defaultPrevented` (Chain of Responsibility), `termCommandForKey` (Command); Contract CON-0021 |
| 2026-10-23 | 0.2.1   | Boris  | Implementiert; Erklärung scrollt beim Öffnen in Sicht (Live-Abnahme 1280 × 720), `layerPart` erschöpfend über `StationKind` (Review) |
