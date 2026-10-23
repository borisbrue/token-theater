# language: de
Funktionalität: Player
  Als Vortragende/r oder Lernende/r
  möchte ich einen Trace Station für Station abspielen, anhalten und zurückspulen
  um den Ablauf eines LLM-Durchlaufs im eigenen Tempo zu erklären oder nachzuvollziehen

  # Uhr: Jeder Test ruft vor dem Öffnen page.clock.install() und direkt danach
  # page.clock.pauseAt(...) auf; Zeit vergeht nur über page.clock.runFor. Das Erzeugen nutzt
  # keine Timer und schließt ohne Vorspulen ab. "Trace T" = Prompt "die katze sitzt",
  # Max. Tokens 2, Erzeugen (Mock und Greedy sind die einzigen Optionen):
  # Schritt 0 mit 12, Schritt 1 mit 11 Stationen. "Seitenfokus herstellen" = Klick auf die
  # Überschrift "Token Theater" (nicht fokussierbar, der Fokus fällt auf den Seitenkörper).
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Ohne Trace keine Wiedergabe
    Dann gibt es keine Region "Wiedergabe"
    Und gibt es keine Region "Tokenstrom" und keine Region "Station"

  Szenario: Nach dem Erzeugen steht der Cursor am Anfang
    Wenn ich Trace T erzeuge
    Dann sehe ich die Region "Wiedergabe" mit den Knöpfen "Zum Anfang", "Schritt zurück", "Station zurück", "Abspielen", "Station vor", "Schritt vor" und "Zum Ende"
    Und zeigt die Region "Station" den Text "Schritt 0 · Station 1 / 12" und die Überschrift "tokenize"
    Und sind "Zum Anfang", "Schritt zurück" und "Station zurück" deaktiviert
    Und ist in der Gruppe "Zeitleiste" der Knopf "Schritt 0" mit aria-current="step" markiert
    Und hat die Gruppe "Stationen" 12 Knöpfe

  Szenario: Station für Station
    Angenommen Trace T ist erzeugt
    Wenn ich zweimal auf "Station vor" klicke
    Dann zeigt die Region "Station" den Text "Schritt 0 · Station 3 / 12" und die Überschrift "attention · Layer 0"
    Und ist in der Gruppe "Stationen" der Knopf "attention · Layer 0" mit aria-current="step" markiert

  Szenario: Schritt vor und Zum Ende
    Angenommen Trace T ist erzeugt
    Wenn ich auf "Schritt vor" klicke
    Dann zeigt die Region "Station" den Text "Schritt 1 · Station 1 / 11" und die Überschrift "embed"
    Und hat die Gruppe "Stationen" 11 Knöpfe
    Wenn ich auf "Zum Ende" klicke
    Dann zeigt die Region "Station" den Text "Schritt 1 · Station 11 / 11" und die Überschrift "sample"
    Und sind "Station vor", "Schritt vor" und "Zum Ende" deaktiviert

  Szenario: Springen über Zeitleiste und Stationsleiste
    Angenommen Trace T ist erzeugt
    Wenn ich in der Gruppe "Zeitleiste" auf "Schritt 1" klicke
    Und in der Gruppe "Stationen" auf "mlp · Layer 1" klicke
    Dann zeigt die Region "Station" den Text "Schritt 1 · Station 8 / 11" und die Überschrift "mlp · Layer 1"

  Szenario: Residual-Stationen sind unterscheidbar
    Angenommen Trace T ist erzeugt
    Dann enthält die Gruppe "Stationen" die Knöpfe "residual · Layer 0 · nach Attention" und "residual · Layer 0 · nach MLP"

  Szenario: Abspielen und Pause
    Angenommen Trace T ist erzeugt
    Wenn ich auf "Abspielen" klicke
    Dann heißt der Knopf "Pause"
    Wenn 1500 ms vergehen
    Dann zeigt die Region "Station" die Überschrift "embed"
    Wenn ich auf "Pause" klicke und 5000 ms vergehen
    Dann zeigt die Region "Station" weiterhin die Überschrift "embed"
    Und heißt der Knopf "Abspielen"

  Szenario: Tempo
    Angenommen Trace T ist erzeugt
    Wenn ich in der Gruppe "Tempo" auf "2×" klicke
    Dann ist "2×" mit aria-pressed="true" und "1×" mit aria-pressed="false" markiert
    Wenn ich auf "Abspielen" klicke und 750 ms vergehen
    Dann zeigt die Region "Station" die Überschrift "embed"

  Szenario: Bis zum Ende abspielen
    Angenommen Trace T ist erzeugt und das Tempo ist "2×"
    Wenn ich auf "Abspielen" klicke und 15000 ms vergehen
    Dann zeigt die Region "Station" den Text "Schritt 1 · Station 11 / 11"
    Und heißt der Knopf "Abspielen"

  Szenario: Tokenstrom folgt dem Cursor
    Angenommen Trace T ist erzeugt
    Dann zeigt die Region "Tokenstrom" die Tokens "die, katze, sitzt" und danach "?"
    Wenn ich in der Gruppe "Stationen" auf "sample" klicke
    Dann zeigt die Region "Tokenstrom" vier Token-Einträge und danach den Platzhalter "nächstes Token"
    Und trägt der vierte Token-Eintrag aria-current="true"

  Szenario: Am Ende kein Platzhalter
    Angenommen Trace T ist erzeugt
    Wenn ich auf "Zum Ende" klicke
    Dann zeigt die Region "Tokenstrom" fünf Token-Einträge und keinen Platzhalter "nächstes Token"

  Szenario: Stationsansicht zeigt Tensorformen und Kandidaten
    Angenommen Trace T ist erzeugt
    Wenn ich in der Gruppe "Stationen" auf "attention · Layer 0" klicke
    Dann enthält die Region "Station" den Text "weights [2, 3, 3]"
    Wenn ich in der Gruppe "Stationen" auf "logits" klicke
    Dann enthält die Region "Station" eine Liste "Kandidaten" mit 10 Einträgen

  Szenariogrundriss: Tastatur
    Angenommen Trace T ist erzeugt und ich habe den Seitenfokus hergestellt
    Wenn ich <taste> drücke
    Dann zeigt die Region "Station" den Text "<text>"

    Beispiele:
      | taste            | text                        |
      | ArrowRight       | Schritt 0 · Station 2 / 12  |
      | Shift+ArrowRight | Schritt 1 · Station 1 / 11  |
      | End              | Schritt 1 · Station 11 / 11 |

  Szenario: Tastatur Pos1 und Rückwärts
    Angenommen Trace T ist erzeugt und der Cursor steht auf "Schritt 1 · Station 3 / 11"
    Wenn ich den Seitenfokus herstelle und Shift+ArrowLeft drücke
    Dann zeigt die Region "Station" den Text "Schritt 1 · Station 1 / 11"
    Wenn ich Home drücke
    Dann zeigt die Region "Station" den Text "Schritt 0 · Station 1 / 12"

  Szenario: Leertaste spielt ab
    Angenommen Trace T ist erzeugt und ich habe den Seitenfokus hergestellt
    Wenn ich die Leertaste drücke
    Dann heißt der Knopf "Pause"

  Szenario: Leertaste auf einem fokussierten Knopf
    Angenommen Trace T ist erzeugt
    Wenn ich per Tab den Knopf "Station vor" fokussiere und die Leertaste drücke
    Dann zeigt die Region "Station" den Text "Schritt 0 · Station 2 / 12"
    Und heißt der Knopf weiterhin "Abspielen"

  Szenario: Kürzel greifen nicht im Prompt-Feld
    Angenommen Trace T ist erzeugt
    Wenn ich in das Feld "Prompt" klicke und ArrowRight sowie die Leertaste drücke
    Dann zeigt die Region "Station" weiterhin den Text "Schritt 0 · Station 1 / 12"
    Und heißt der Knopf "Abspielen"

  Szenario: Live-Region meldet die Position
    Angenommen Trace T ist erzeugt
    Wenn ich auf "Station vor" klicke
    Dann enthält die Statusmeldung "Schritt 0 · Station 2 von 12 · embed"

  Szenario: Statusmeldung während der Wiedergabe nur bei Schrittwechsel
    Angenommen Trace T ist erzeugt und das Tempo ist "2×"
    Wenn ich auf "Abspielen" klicke und 750 ms vergehen
    Dann enthält die Statusmeldung weiterhin "Schritt 0 · Station 1 von 12 · tokenize"
    Wenn weitere 6850 ms vergehen
    Dann enthält die Statusmeldung "Schritt 1 · Station 1 von 11 · embed"

  Szenario: Trace mit einem Schritt
    Wenn ich den Prompt "der hund" mit Max. Tokens 1 erzeuge
    Dann hat die Gruppe "Zeitleiste" 1 Knopf
    Und sind "Schritt zurück" und "Schritt vor" deaktiviert

  Szenario: Neuer Trace setzt zurück
    Angenommen Trace T ist erzeugt und der Cursor steht auf "Schritt 1 · Station 3 / 11"
    Wenn ich den Prompt "der hund" mit Max. Tokens 1 erzeuge
    Dann zeigt die Region "Station" den Text "Schritt 0 · Station 1 / 12"
    Und hat die Gruppe "Zeitleiste" 1 Knopf

  Szenario: Fehlgeschlagener Import lässt den Cursor stehen
    Angenommen Trace T ist erzeugt und der Cursor steht auf "Schritt 0 · Station 3 / 12"
    Wenn ich eine Datei mit dem Inhalt "hallo" über "Trace importieren" lade
    Dann zeigt die Region "Station" weiterhin den Text "Schritt 0 · Station 3 / 12"

  # Schriftfamilie: erster Eintrag der berechneten font-family, Anführungszeichen entfernt.
  Szenario: Aurora-Theme ist aktiv
    Dann entspricht die Hintergrundfarbe des Seitenkörpers COLORS.bg aus src/app/theme/tokens.ts
    Und ist die erste Schriftfamilie des Seitenkörpers "Inter Variable"
    Und ist die erste Schriftfamilie der Überschrift "Token Theater" "Space Grotesk"

  Szenario: Fokusring und Mindestgröße
    Angenommen Trace T ist erzeugt
    Wenn ich per Tab den Knopf "Station vor" fokussiere
    Dann hat er eine sichtbare Umrandung in der Farbe COLORS.cyan
    Und ist jeder Knopf in der Region "Wiedergabe" mindestens 44 × 44 px groß

  Szenario: Reduzierte Bewegung
    Angenommen der Browser meldet prefers-reduced-motion "reduce" und Trace T ist erzeugt
    Dann hat der aktuelle Knopf der Gruppe "Stationen" die transition-duration "0s"
