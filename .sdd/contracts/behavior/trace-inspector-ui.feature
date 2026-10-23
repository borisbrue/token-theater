# language: de
Funktionalität: Trace-Inspector
  Als Vortragende/r oder Lernende/r
  möchte ich einen Mock-Trace erzeugen, seine Stationen sehen sowie Traces exportieren und importieren
  um den Ablauf eines LLM-Durchlaufs nachzuvollziehen und Vorführungen offline zu wiederholen

  # "ich sehe n Schritte" = genau n Überschriften der Ebene 2 mit dem Text "Schritt <i>" (i = 0..n−1)
  # innerhalb der Liste "Schritte". Stationen werden je Schritt als listitems unterhalb dieser Überschrift gezählt.
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Startzustand
    Dann sehe ich die Überschrift "Token Theater"
    Und ist das Feld "Max. Tokens" mit 8 vorbelegt
    Und ist der Knopf "Erzeugen" deaktiviert
    Und ist der Knopf "Trace exportieren" deaktiviert
    Und sehe ich 0 Schritte

  Szenario: Erzeugen wird mit Eingabe aktiv
    Wenn ich in "Prompt" den Text "die" eingebe
    Dann ist der Knopf "Erzeugen" aktiv

  Szenario: Prompt nur aus Leerzeichen
    Wenn ich in "Prompt" den Text "   " eingebe
    Dann ist der Knopf "Erzeugen" deaktiviert

  Szenario: Mock-Trace erzeugen und ansehen
    Wenn ich in "Prompt" den Text "die katze sitzt" eingebe
    Und "Max. Tokens" auf 4 setze
    Und auf "Erzeugen" klicke
    Dann sehe ich 4 Schritte
    Und zeigt Schritt 0 die Stationen "tokenize, embed, attention, residual, mlp, residual, attention, residual, mlp, residual, logits, sample"
    Und enthält die Zeile der attention-Station von Schritt 0 in Layer 0 den Text "weights [2, 3, 3]"
    Und beginnt der erzeugte Text mit "die katze sitzt"
    Und ist der Knopf "Trace exportieren" aktiv

  Szenario: Erzeugen per Tastatur
    Wenn ich per Tab zum Feld "Prompt" wechsle und "die katze" tippe
    Und per Tab zum Knopf "Erzeugen" wechsle und Enter drücke
    Dann sehe ich 8 Schritte

  Szenariogrundriss: Max. Tokens wird begrenzt
    Wenn ich in "Prompt" den Text "die katze" eingebe
    Und "Max. Tokens" auf "<eingabe>" setze und das Feld verlasse
    Dann zeigt das Feld "Max. Tokens" den Wert <angezeigt>

    Beispiele:
      | eingabe | angezeigt |
      | 0       | 1         |
      | 50      | 32        |
      | 12      | 12        |
      | 2.5     | 2         |
      |         | 8         |

  Szenario: Export und Import
    Angenommen ich habe "die katze sitzt" mit "Max. Tokens" 3 erzeugt
    Und ich habe mir den erzeugten Text und alle Stationszeilen gemerkt
    Wenn ich auf "Trace exportieren" klicke
    Dann wird eine Datei heruntergeladen, deren Name dem Muster "^[0-9a-f-]{36}\.trace\.json$" entspricht
    Wenn ich die Seite neu lade und diese Datei über "Trace importieren" lade
    Dann sehe ich 3 Schritte
    Und zeigt der Inspector denselben erzeugten Text wie vor dem Export
    Und zeigt der Inspector dieselben Stationszeilen wie vor dem Export
    Und ist der Knopf "Trace exportieren" aktiv

  Szenario: Ungültiger Import behält den vorherigen Trace
    Angenommen ich habe "die katze sitzt" mit "Max. Tokens" 3 erzeugt
    Wenn ich eine Datei mit dem Inhalt '{"id":"x"}' über "Trace importieren" lade
    Dann sehe ich die Fehlermeldung "Die Datei enthält keine Trace-Version (schemaVersion)."
    Und sehe ich weiterhin 3 Schritte

  Szenario: Zukünftige Trace-Version
    Wenn ich eine Datei mit dem Inhalt '{"schemaVersion":2}' über "Trace importieren" lade
    Dann sehe ich die Fehlermeldung "Trace-Version 2 wird nicht unterstützt."

  Szenario: Kein JSON
    Wenn ich eine Datei mit dem Inhalt "hallo" über "Trace importieren" lade
    Dann sehe ich die Fehlermeldung "Die Datei ist kein gültiges JSON."

  Szenario: Schemafehler mit Pfad
    Angenommen eine exportierte Trace-Datei von "die katze sitzt" mit "Max. Tokens" 3, in der bei steps/0 das Feld "chosen" entfernt ist
    Wenn ich sie über "Trace importieren" lade
    Dann beginnt die Fehlermeldung mit "Die Datei entspricht nicht dem Trace-Format."
    Und enthält sie "/steps/0"

  Szenario: Semantischer Fehler mit Pfad
    Angenommen eine exportierte Trace-Datei von "die katze sitzt" mit "Max. Tokens" 3, in der bei steps/0/stations/2 die weights-Daten um genau 4 Bytes gekürzt und gültig neu Base64-kodiert sind
    Wenn ich sie über "Trace importieren" lade
    Dann beginnt die Fehlermeldung mit "Der Trace ist inkonsistent."
    Und enthält sie "/steps/0/stations/2/weights" und "INV-01"
