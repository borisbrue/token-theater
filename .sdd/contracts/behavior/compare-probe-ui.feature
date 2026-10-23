# language: de
Funktionalität: Vergleich zweier Läufe und Sonden-Bericht
  Als Lernende/r oder Vortragende/r
  möchte ich zwei Läufe mit verschiedenen Prompts gegenüberstellen und einen Sonden-Bericht ansehen
  um zu sehen, wo und wie stark ein Modell auf ein einzelnes Merkmal reagiert

  # "Mock-Lauf <p>" / "Mock-MoE-Lauf <p>": Radio "Mock" bzw. "Mock-MoE" in der Gruppe "Engine",
  # Prompt <p>, Max. Tokens 2, "Erzeugen", warten bis die Gruppe "Zeitleiste" 2 Knöpfe hat.
  # "Vergleichstrace <p>": ein Mock-Lauf <p> (bzw. Mock-MoE-Lauf), über "Trace exportieren"
  # gespeichert und danach über "Vergleichstrace importieren" geladen; der Lauf A wird nach dem
  # Export erzeugt. "Vergleich öffnen" = Knopf "Vergleich" in der Gruppe "Ansicht".
  # "Ausgabe", "Layer", "Paare" = Tabelle mit dieser caption; "Läufe", "Zusammenfassung",
  # "Begriffe" = Liste mit diesem aria-label. Erwartete Zahlen rechnet der Test mit
  # @/views/compare/diff aus den exportierten Traces bzw. aus dem Bericht-Fixture
  # tests/fixtures/probe/tiny-occupation-gender-en.probe-report.json ("Bericht-Fixture").
  # Zahlen: Prozent mit einer Nachkommastelle und Dezimalkomma, Minus ist U+2212.
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Knöpfe der Ansicht
    Dann hat die Gruppe "Ansicht" die Knöpfe "Durchlauf", "Tokenizer", "Glossar", "Vergleich" und "Sonde" in dieser Reihenfolge

  Szenario: Vergleich ohne Läufe
    Wenn ich den Vergleich öffne
    Dann gibt es die Region "Vergleich" mit der Überschrift "Vergleich" und der Datei-Eingabe "Vergleichstrace importieren"
    Und lautet ihr Hinweis (role="note") "Erzeuge zuerst einen Lauf oder importiere einen Trace; er wird Lauf A."
    Und gibt es keine Tabelle "Ausgabe"

  Szenario: Vergleich ohne Lauf B
    Angenommen ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann enthält "Läufe" genau den Eintrag "A · mock-de-52 · „die katze sitzt“"
    Und lautet der Hinweis "Importiere einen Vergleichstrace; er wird Lauf B."

  Szenario: Zwei Mock-Läufe vergleichen
    Angenommen ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann enthält "Läufe" die Einträge "A · mock-de-52 · „die katze sitzt“" und "B · mock-de-52 · „der hund sitzt“"
    Und hat die Radio-Gruppe "Schritt" die Optionen "Schritt 0" und "Schritt 1", gewählt ist "Schritt 0"
    Und hat "Ausgabe" die Spaltenköpfe "Token", "p A", "p B" und "Δ (Prozentpunkte)"
    Und hat "Ausgabe" je Zeile von outputDiff eine Zeile mit Token (␣ für Leerzeichen), p A, p B und Δ wie berechnet
    Und hat die Zeile des Tokens, das A wählt, die Klasse "chosen-a" und die des Tokens, das B wählt, die Klasse "chosen-b"
    Und lautet ".compare-js" "JS-Divergenz: <js> (0 = gleich, 1 = ohne Überschneidung)" mit drei Nachkommastellen
    Und hat "Layer" die Spaltenköpfe "Layer", "Kosinus", "Lens A" und "Lens B" und die Zeilenköpfe "Layer 0" und "Layer 1"
    Und zeigt "Kosinus" je Zeile den Wert aus layerDiff mit drei Nachkommastellen

  Szenario: Größter Abfall
    Angenommen ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann hat genau die Zeile des Layers aus largestDrop die Klasse "largest-drop"
    Und lautet ".compare-drop" "Größter Abfall der Ähnlichkeit: Layer <l>"

  Szenario: Schritt wechseln
    Angenommen ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne und "Schritt 1" wähle
    Dann lautet ".compare-chosen" "A wählt „<Token A>“ · B wählt „<Token B>“" mit den in Schritt 1 gewählten Tokens
    Und zeigt "Ausgabe" die Zeilen von outputDiff für Schritt 1

  Szenario: Lauf mit sich selbst vergleichen
    Angenommen ein Vergleichstrace "die katze sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann zeigt jede Δ-Zelle "0,0"
    Und lautet ".compare-js" "JS-Divergenz: 0,000 (0 = gleich, 1 = ohne Überschneidung)"
    Und zeigt jede Kosinus-Zelle "1,000"
    Und gibt es keine Zeile der Klasse "largest-drop" und kein ".compare-drop"

  Szenario: MoE-Läufe vergleichen
    Angenommen ein Vergleichstrace aus einem Mock-MoE-Lauf "der hund sitzt" und ein Mock-MoE-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann hat "Layer" zusätzlich die Spalte "Experten gemeinsam"
    Und zeigt sie je Zeile "<k> von 2" mit k aus expertOverlap · 2

  Szenario: Verschiedene Modelle
    Angenommen ein Vergleichstrace aus einem Mock-MoE-Lauf "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann lautet der Hinweis "Verschiedene Modelle: verglichen wird nur die Ausgabe."
    Und gibt es die Tabelle "Ausgabe" und keine Tabelle "Layer"

  Szenario: Vergleichstrace ohne Interna
    Angenommen ein Mock-Lauf "die katze sitzt" und als Vergleichstrace ein exportierter Mock-Lauf "der hund sitzt", im Test auf die Fähigkeiten "tokenize", "logits" und "sample" gekürzt
    Wenn ich den Vergleich öffne
    Dann lautet der Hinweis "Ein Lauf hat keine Interna: verglichen wird nur die Ausgabe."
    Und gibt es die Tabelle "Ausgabe" und keine Tabelle "Layer"

  Szenario: Verschiedene Vokabulare
    Angenommen ein Mock-Lauf "die katze sitzt" und als Vergleichstrace tests/fixtures/moe/tiny-granitemoe.trace.json
    Wenn ich den Vergleich öffne
    Dann lautet der Hinweis "Verschiedene Vokabulare: Die Läufe sind nicht vergleichbar."
    Und gibt es keine Tabelle "Ausgabe" und keine Radio-Gruppe "Schritt"

  Szenario: Fehlerhafter Vergleichstrace
    Angenommen ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne und die Datei "{" über "Vergleichstrace importieren" lade
    Dann zeigt die Region "Vergleich" die Fehlermeldung (role="alert") "Die Datei ist kein gültiges JSON."
    Und enthält "Läufe" weiter "B · mock-de-52 · „der hund sitzt“"

  Szenario: Neuer Lauf A setzt den Schritt zurück
    Angenommen ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne und "Schritt 1" wähle
    Und ich in "Durchlauf" einen Mock-Lauf "das kind lacht" erzeuge und den Vergleich öffne
    Dann ist "Schritt 0" gewählt
    Und enthält "Läufe" "A · mock-de-52 · „das kind lacht“"

  Szenario: Begriffe im Vergleich
    Angenommen ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann enthält "Begriffe" genau die Knöpfe "Gegenfakt", "Kosinus-Ähnlichkeit", "JS-Divergenz" und "Logit-Lens"
    Wenn ich in "Begriffe" auf "Gegenfakt" klicke
    Dann lautet die Erklärung "Gegenfakt Ein zweiter Prompt, der sich vom ersten nur in einem Merkmal unterscheidet, etwa „nurse“ statt „doctor“. Was sich dann in der Ausgabe ändert, hängt mit diesem Merkmal zusammen. In der App: Lauf B in der Ansicht „Vergleich“ und Prompt B jedes Paars einer Sonde."

  Szenario: Sonde ohne Bericht
    Wenn ich in der Gruppe "Ansicht" auf "Sonde" klicke
    Dann gibt es die Region "Sonde" mit der Überschrift "Sonde" und der Datei-Eingabe "Sonden-Bericht importieren"
    Und lautet ihr Hinweis "Noch kein Bericht geladen."

  Szenario: Sonden-Bericht anzeigen
    Wenn ich "Sonde" öffne und das Bericht-Fixture über "Sonden-Bericht importieren" lade
    Dann lautet ".probe-head" "Sonde occupation-gender-en · Modell tiny-random-gpt2"
    Und lautet der Hinweis (role="note") "Die Zahlen zeigen, wie verschieden das Modell auf zwei Prompts reagiert. Ob das ein Bias ist, hängt von den Paaren ab und bleibt eine menschliche Bewertung."
    Und enthält "Zusammenfassung" "12 Paare", die Umschwünge des Fixtures ("1 Umschwung" oder "<n> Umschwünge") und "Mittlere Verschiebung: <m>" mit zwei Nachkommastellen
    Und hat "Paare" die Spaltenköpfe "Paar", "Prompt A", "Prompt B", "Ziele", "log-Verhältnis A → B" und "JS-Divergenz"
    Und hat "Paare" 12 Zeilen mit den Paar-IDs als Zeilenköpfen in der Reihenfolge des Fixtures
    Und zeigt "Ziele" je Ziel "„<Ziel mit ␣>“ <pA> → <pB>"
    Und zeigt "log-Verhältnis A → B" "<A> → <B>" mit zwei Nachkommastellen, bei flip mit " · Umschwung" am Ende und der Klasse "flip" an der Zeile
    Und zeigt "JS-Divergenz" den Wert mit drei Nachkommastellen

  Szenario: Sortierung nach Verschiebung
    Wenn ich "Sonde" öffne und das Bericht-Fixture lade
    Und ich in der Radio-Gruppe "Sortierung" "Größte Verschiebung" wähle
    Dann stehen die Zeilen nach |logRatioB − logRatioA| absteigend, bei Gleichstand in der Reihenfolge des Fixtures
    Wenn ich "Reihenfolge der Sonde" wähle
    Dann stehen sie wieder in der Reihenfolge des Fixtures

  Szenario: Inkonsistenter Bericht
    Wenn ich "Sonde" öffne und das Bericht-Fixture mit summary.flips um 1 erhöht lade
    Dann lautet die Fehlermeldung (role="alert") "Der Bericht ist inkonsistent."
    Und beginnt eine Detailzeile mit "/summary/flips (RP-04): "

  Szenario: Sonde statt Bericht
    Wenn ich "Sonde" öffne und scripts/probes/occupation-gender-en.probe.json über "Sonden-Bericht importieren" lade
    Dann lautet die Fehlermeldung "Die Datei entspricht nicht dem Format eines Sonden-Berichts."

  Szenario: Unbekannte Berichts-Version
    Wenn ich "Sonde" öffne und das Bericht-Fixture mit schemaVersion 2 lade
    Dann lautet die Fehlermeldung "Berichts-Version 2 wird nicht unterstützt."

  Szenario: Kein Urteil
    Angenommen ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann enthält die Region "Vergleich" keines der Wörter "Bias", "sicher", "unbedenklich" und "kompromittiert"
    Wenn ich "Sonde" öffne und das Bericht-Fixture lade
    Dann enthält die Region "Sonde" "Bias" nur im festen Hinweis und keines der Wörter "sicher", "unbedenklich" und "kompromittiert"

  Szenario: Kein waagerechtes Scrollen
    Angenommen das Fenster ist 1280 × 720 groß und ein Vergleichstrace "der hund sitzt" und ein Mock-Lauf "die katze sitzt"
    Wenn ich den Vergleich öffne
    Dann ist die Seite nicht breiter als das Fenster
    Wenn ich "Sonde" öffne und das Bericht-Fixture lade
    Dann ist die Seite nicht breiter als das Fenster
