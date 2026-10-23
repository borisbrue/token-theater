# language: de
Funktionalität: Sampling-Steuerung, Logits-Ansicht, Sampling-Labor und Zufallswurf
  Als Lernende/r oder Vortragende/r
  möchte ich sehen, wie aus einer Wahrscheinlichkeitsverteilung ein Token gezogen wird
  um Temperatur, Top-k, Top-p und den Zufall eines Sprachmodells zu verstehen

  # "Erzeugen mit P und n" = Prompt P, Max. Tokens n, Knopf "Erzeugen" (wie CON-0003).
  # "Zufall einstellen" = in der Gruppe "Sampling" die Option "Zufall" wählen und die genannten
  # Felder füllen (Schieberegler per fill). "Station s öffnen" = in der Gruppe "Stationen" auf s
  # klicken. Prozentwerte: eine Nachkommastelle, Dezimalkomma, Leerzeichen vor "%" ("41,2 %").
  # "Kandidaten-Eintrag" = Eintrag der Liste "Kandidaten" in der Region "Station";
  # "Labor-Eintrag" = Eintrag der Liste "Labor-Verteilung".
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Startzustand der Sampling-Steuerung
    Dann ist in der Gruppe "Sampling" die Option "Greedy" gewählt
    Und sind "Temperatur", "Top-k", "Top-p" und "Seed" deaktiviert
    Und haben sie die Werte "1", "0", "1" und "42"

  Szenario: Zufall schaltet die Felder frei
    Wenn ich in der Gruppe "Sampling" die Option "Zufall" wähle
    Dann sind "Temperatur", "Top-k", "Top-p" und "Seed" aktiviert
    Wenn ich "Temperatur" auf "0.7" setze
    Dann zeigt die Gruppe "Sampling" den Text "0,7"

  Szenario: Gleicher Seed, gleicher Text
    Angenommen Zufall ist eingestellt mit Seed "7"
    Wenn ich mit "die katze sitzt" und 4 erzeuge
    Und ich mit "die katze sitzt" und 4 erneut erzeuge
    Dann ist der Text der Region "Erzeugter Text" beide Male gleich

  Szenario: Export enthält die Sampling-Parameter
    Angenommen Zufall ist eingestellt mit Temperatur "0.5", Top-k "5", Top-p "0.9" und Seed "7"
    Wenn ich mit "die katze sitzt" und 2 erzeuge und den Trace exportiere
    Dann ist sampling gleich {"strategy": "sample", "seed": 7, "params": {"temperature": 0.5, "topK": 5, "topP": 0.9}}

  Szenario: Top-k 1 entspricht Greedy
    Angenommen ich habe mit Greedy "die katze sitzt" und 4 erzeugt und mir den Text gemerkt
    Wenn ich Zufall mit Top-k "1" und Seed "3" einstelle und mit "die katze sitzt" und 4 erzeuge
    Dann ist der Text der Region "Erzeugter Text" der gemerkte

  Szenario: Top-p 0,05 entspricht Greedy
    Angenommen ich habe mit Greedy "die katze sitzt" und 4 erzeugt und mir den Text gemerkt
    Wenn ich Zufall mit Top-p "0.05" und Seed "11" einstelle und mit "die katze sitzt" und 4 erzeuge
    Dann ist der Text der Region "Erzeugter Text" der gemerkte

  Szenario: Ungültige Zahlen werden normalisiert
    Angenommen Zufall ist eingestellt mit Top-k "250" und Seed "-5"
    Wenn ich mit "die katze sitzt" und 1 erzeuge
    Dann hat "Top-k" den Wert "100" und "Seed" den Wert "0"

  Szenario: Logits als Balken
    Wenn ich mit "die katze sitzt" und 2 erzeuge und die Station "logits" öffne
    Dann hat die Liste "Kandidaten" 10 Einträge
    Und enthält jeder Kandidaten-Eintrag einen Prozentwert, absteigend sortiert
    Und zeigt die Region "Station" einen Text "+ 42 weitere Tokens mit zusammen …"

  Szenario: Labor mit Top-k
    Angenommen ich habe mit "die katze sitzt" und 2 erzeugt und die Station "logits" geöffnet
    Wenn ich "Labor-Top-k" auf "2" setze
    Dann enden der dritte bis zehnte Labor-Eintrag mit "entfernt"
    Und ergeben die neuen Prozentwerte der ersten beiden Labor-Einträge zusammen 100 ± 0,2

  Szenario: Labor mit Temperatur und Zurücksetzen
    Angenommen ich habe mit "die katze sitzt" und 2 erzeugt und die Station "logits" geöffnet
    Wenn ich "Labor-Temperatur" auf "0.3" setze
    Dann ist der neue Prozentwert des ersten Labor-Eintrags größer als sein Originalwert
    Wenn ich auf "Zurücksetzen" klicke
    Dann haben "Labor-Temperatur", "Labor-Top-k" und "Labor-Top-p" die Werte "1", "0" und "1"
    Und ist in jedem Labor-Eintrag der neue Prozentwert gleich dem Originalwert

  Szenario: Labor ändert den Trace nicht
    Angenommen ich habe mit "die katze sitzt" und 2 erzeugt und die Station "logits" geöffnet
    Wenn ich "Labor-Top-p" auf "0.05" setze
    Dann enthält der erste Labor-Eintrag "100,0 %"
    Und zeigt die Region "Station" weiterhin "Schritt 0 · Station 11 / 12"
    Und ist der Text der Region "Erzeugter Text" unverändert

  Szenario: Labor übernimmt die Trace-Parameter
    Angenommen Zufall ist eingestellt mit Temperatur "0.5", Top-k "5", Top-p "0.9" und Seed "7"
    Wenn ich mit "die katze sitzt" und 2 erzeuge und die Station "logits" öffne
    Dann haben "Labor-Temperatur", "Labor-Top-k" und "Labor-Top-p" die Werte "0.5", "5" und "0.9"

  Szenario: Pfeiltasten im Labor bewegen nur den Regler
    Angenommen ich habe mit "die katze sitzt" und 2 erzeugt und die Station "logits" geöffnet
    Wenn ich "Labor-Temperatur" fokussiere und ArrowRight drücke
    Dann hat "Labor-Temperatur" den Wert "1.1"
    Und zeigt die Region "Station" weiterhin "Schritt 0 · Station 11 / 12"

  Szenario: Greedy-Wurf
    Wenn ich mit "die katze sitzt" und 2 erzeuge und die Station "sample" öffne
    Dann zeigt die Region "Station" den Text "Strategie: Greedy"
    Und zeigt die Region "Station" "Greedy: kein Zufall, gewählt wird das wahrscheinlichste Token „<t>“." mit dem ersten Kandidaten-Eintrag als <t>
    Und trägt der erste Kandidaten-Eintrag aria-current="true"

  Szenario: Sichtbarer Zufallswurf
    Angenommen Zufall ist eingestellt mit Seed "7"
    Wenn ich mit "die katze sitzt" und 2 erzeuge und die Station "sample" öffne
    Dann zeigt die Region "Station" den Text "Temperatur 1,0 · Top-k aus · Top-p 1,00 · Seed 7"
    Und zeigt die Region "Station" "Zufallszahl 0,ddd fällt auf „<t>“"
    Und trägt genau ein Kandidaten-Eintrag aria-current="true", und er beginnt mit <t>
    Und ist <t> das neue Token in der Region "Tokenstrom"

  Szenario: Verteilung ohne Logits
    Wenn ich die Datei "tests/fixtures/traces/remote-top3.trace.json" über "Trace importieren" lade und die Station "logits" öffne
    Dann hat die Liste "Kandidaten" 3 Einträge, der erste enthält "␣Katze", "50,0 %" und "–"
    Und zeigt die Region "Station" den Text "Nur die 3 gelieferten Kandidaten, sie decken 80,0 % ab."
    Wenn ich "Labor-Temperatur" auf "0.5" setze
    Dann enthalten die Labor-Einträge der Reihe nach "65,8 %", "23,7 %" und "10,5 %"

  Szenario: Unbekannte Abdeckung
    Wenn ich die Datei "tests/fixtures/traces/gpt2-bpe.trace.json" über "Trace importieren" lade und die Station "logits" öffne
    Dann zeigt die Region "Station" den Text "Abdeckung der Verteilung unbekannt."
