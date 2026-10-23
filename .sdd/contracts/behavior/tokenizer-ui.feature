# language: de
Funktionalität: Tokenizer-Werkbank und tokenize-Station
  Als Lernende/r oder Vortragende/r
  möchte ich sehen, wie GPT-2 einen Text in Tokens zerlegt und wie BPE jedes Wort zusammensetzt
  um zu verstehen, was das Modell als Eingabe bekommt

  # "Werkbank öffnen" = in der Gruppe "Ansicht" auf "Tokenizer" klicken und warten, bis die Liste
  # "Tokens" in der Region "Tokenizer" erscheint. "Text eingeben" = das Feld "Text" leeren und
  # füllen (fill). Ein Token-Eintrag ist ein Eintrag der Liste "Tokens"; er enthält den
  # Anzeigetext und die ID. "Token wählen" = auf den Knopf des Eintrags mit diesem Anzeigetext
  # klicken. "Trace T" wie in CON-0006 ("die katze sitzt", Max. Tokens 2, Erzeugen). In Texten
  # stehen \n und \t für Zeilenumbruch und Tabulator.
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Umschalter zeigt den Durchlauf
    Dann enthält die Gruppe "Ansicht" die Knöpfe "Durchlauf" mit aria-pressed="true" und "Tokenizer" mit aria-pressed="false"
    Und gibt es keine Region "Tokenizer"
    Und ist das Feld "Prompt" sichtbar

  Szenario: Werkbank öffnen
    Wenn ich die Werkbank öffne
    Dann ist "Tokenizer" mit aria-pressed="true" markiert
    Und ist das Feld "Prompt" nicht vorhanden
    Und hat das Feld "Text" den Wert "Die Katze schläft auf dem Sofa."
    Und zeigt die Liste "Kennzahlen" die Einträge "31 Zeichen", "32 Bytes" und "13 Tokens"
    Und hat die Liste "Tokens" 13 Einträge
    Und enthält der zweite Token-Eintrag "␣Kat" und "8595"
    Und zeigt die Region "Tokenizer" den Text "32423 8595 2736 5513 75 11033 701 257 3046 1357 1406 13331 13"
    Und zeigt die Region "Tokenizer" den Hinweis "Wähle ein Token, um seine BPE-Schritte zu sehen."

  Szenario: Live-Zerlegung bei Eingabe
    Angenommen die Werkbank ist geöffnet
    Wenn ich den Text "Hello world" eingebe
    Dann zeigt die Liste "Kennzahlen" die Einträge "11 Zeichen", "11 Bytes" und "2 Tokens"
    Und sind die Token-Einträge der Reihe nach "Hello" mit "15496" und "␣world" mit "995"

  Szenario: Emoji und Umlaute zerfallen in Bytes
    Angenommen die Werkbank ist geöffnet
    Wenn ich den Text "🦊 Füchse" eingebe
    Dann zeigt die Liste "Kennzahlen" die Einträge "8 Zeichen", "12 Bytes" und "7 Tokens"
    Und sind die Token-Einträge der Reihe nach "<F0 9F>" mit "8582", "<A6>" mit "99", "<8A>" mit "232", "␣F" mit "376", "ü" mit "9116", "ch" mit "354" und "se" mit "325"

  Szenario: Leerzeichen, Tabulatoren und Zeilenumbrüche sind sichtbar
    Angenommen die Werkbank ist geöffnet
    Wenn ich den Text "Zeile eins\n\tzwei  drei" eingebe
    Dann hat die Liste "Tokens" 12 Einträge
    Und sind die Anzeigetexte der Reihe nach "Ze", "ile", "␣e", "ins", "↵", "⇥", "z", "wei", "␣", "␣d", "re", "i"

  Szenario: Leerer Text
    Angenommen die Werkbank ist geöffnet
    Wenn ich den Text "" eingebe
    Dann zeigt die Liste "Kennzahlen" den Eintrag "0 Tokens"
    Und hat die Liste "Tokens" 0 Einträge
    Und gibt es keine Meldung mit role="alert"

  Szenario: Benachbarte Tokens haben verschiedene Farben
    Angenommen die Werkbank ist geöffnet
    Dann unterscheidet sich die berechnete border-top-color jedes Token-Knopfs von der seines Vorgängers
    Und hat der fünfte Token-Knopf dieselbe border-top-color wie der erste

  Szenario: BPE-Schritte eines Wortes
    Angenommen die Werkbank ist geöffnet
    Wenn ich das Token "␣Kat" wähle
    Dann zeigt die Region "BPE-Schritte" die Überschrift "BPE-Schritte für „␣Katze“"
    Und hat die Liste "Merges" 5 Einträge
    Und beginnt der erste Eintrag mit "Start" und enthält "␣", "K", "a", "t", "z" und "e"
    Und enthält der zweite Eintrag "Merge 1 · Rang 9"
    Und enthält der fünfte Eintrag "Merge 4 · Rang 8339", "␣Kat" und "ze"
    Und tragen die Token-Knöpfe "␣Kat" und "ze" aria-pressed="true" und "Die" aria-pressed="false"

  Szenario: Wort ohne Merge
    Angenommen die Werkbank ist geöffnet
    Wenn ich das Token "." wähle
    Dann hat die Liste "Merges" 1 Eintrag, der mit "Start" beginnt

  Szenario: Neuer Text setzt die Auswahl zurück
    Angenommen die Werkbank ist geöffnet und das Token "␣Kat" ist gewählt
    Wenn ich den Text "Hello world" eingebe
    Dann gibt es keine Region "BPE-Schritte"
    Und zeigt die Region "Tokenizer" den Hinweis "Wähle ein Token, um seine BPE-Schritte zu sehen."

  Szenario: Tastaturbedienung der Tokenliste
    Angenommen die Werkbank ist geöffnet
    Wenn ich den Knopf des Tokens "␣Kat" per Tab fokussiere und Enter drücke
    Dann zeigt die Region "BPE-Schritte" die Überschrift "BPE-Schritte für „␣Katze“"

  Szenario: Vokabular wird erst beim Öffnen geladen
    Dann wurde noch keine Anfrage an "/tokenizers/gpt2/vocab.json" oder "/tokenizers/gpt2/merges.txt" gestellt
    Wenn ich die Werkbank öffne, auf "Durchlauf" und wieder auf "Tokenizer" klicke
    Dann ging genau eine Anfrage an "/tokenizers/gpt2/vocab.json" und genau eine an "/tokenizers/gpt2/merges.txt", beide an den eigenen Origin

  Szenario: Ladeanzeige
    Angenommen die Antwort auf "/tokenizers/gpt2/vocab.json" wird zurückgehalten
    Wenn ich in der Gruppe "Ansicht" auf "Tokenizer" klicke
    Dann zeigt die Region "Tokenizer" den Text "GPT-2-Vokabular wird geladen …"
    Wenn die Antwort freigegeben wird
    Dann hat die Liste "Tokens" 13 Einträge
    Und ist der Text "GPT-2-Vokabular wird geladen …" verschwunden

  Szenario: Laden schlägt fehl und wird wiederholt
    Angenommen "/tokenizers/gpt2/vocab.json" antwortet mit Status 404
    Wenn ich in der Gruppe "Ansicht" auf "Tokenizer" klicke
    Dann zeigt eine Meldung mit role="alert" "Das GPT-2-Vokabular konnte nicht geladen werden."
    Und gibt es den Knopf "Erneut versuchen"
    Wenn "/tokenizers/gpt2/vocab.json" wieder normal antwortet und ich auf "Erneut versuchen" klicke
    Dann hat die Liste "Tokens" 13 Einträge
    Und gibt es keine Meldung mit role="alert"

  Szenario: Werkbank lässt Trace und Cursor unberührt
    Angenommen Trace T ist erzeugt und ich habe zweimal auf "Station vor" geklickt
    Wenn ich die Werkbank öffne, auf die Überschrift "Token Theater" klicke und ArrowRight sowie die Leertaste drücke
    Und in der Gruppe "Ansicht" auf "Durchlauf" klicke
    Dann zeigt die Region "Station" den Text "Schritt 0 · Station 3 / 12"
    Und heißt der Knopf "Abspielen"

  Szenario: tokenize-Station eines Mock-Traces
    Angenommen Trace T ist erzeugt
    Dann zeigt die Region "Station" die Überschrift "tokenize"
    Und enthält die Region "Station" die Liste "Tokens" mit 3 Einträgen "die" mit "2", "katze" mit "7" und "sitzt" mit "18"
    Und enthält die Liste "Tokens" keine Knöpfe
    Und zeigt die Region "Station" den Hinweis "Dieser Trace enthält keine BPE-Schritte."

  Szenario: tokenize-Station eines Traces mit BPE-Details
    Wenn ich die Datei "tests/fixtures/traces/gpt2-bpe.trace.json" über "Trace importieren" lade
    Dann zeigt die Region "Station" den Text "Schritt 0 · Station 1 / 3"
    Und sind die Token-Einträge der Region "Station" der Reihe nach "Die" mit "32423", "␣Kat" mit "8595" und "ze" mit "2736"
    Wenn ich in der Region "Station" das Token "␣Kat" wähle
    Dann zeigt die Region "BPE-Schritte" die Überschrift "BPE-Schritte für „␣Katze“"
    Und hat die Liste "Merges" 5 Einträge
    Und enthält die Region "Station" genau eine Überschrift der Ebene 2

  Szenario: Token-Knöpfe sind groß genug
    Angenommen die Werkbank ist geöffnet
    Dann ist jeder Token-Knopf mindestens 44 px hoch
