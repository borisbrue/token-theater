# language: de
Funktionalität: GPT-2 im Browser
  Als Lernende/r oder Vortragende/r
  möchte ich ein echtes GPT-2 im Browser rechnen lassen
  um jede Station eines echten Transformers abspielen zu können

  # Modell-Server: Playwright fängt "<Origin>/models/**" ab (eigener Origin). index.json liefert
  # { "models": [{ "id": "tiny", "name": "Tiny GPT-2 (Test)", "config": "tiny/config.json",
  # "weights": "tiny/model.safetensors", "bytes": 1619136 }] }; tiny/config.json und
  # tiny/model.safetensors liefern tests/fixtures/gpt2/tiny-gpt2.config.json bzw.
  # tiny-gpt2.safetensors (mit Content-Length). Einzelne Szenarien überschreiben Antworten.
  # "GPT-2 wählen" = in der Gruppe "Engine" die Option "GPT-2 (Browser)" wählen.
  # "Erzeugen" = Prompt "Die Katze sitzt", Max. Tokens 3, Knopf "Erzeugen".
  # Erwartete Werte stammen aus tests/fixtures/gpt2/tiny-gpt2.golden.json (Greedy: Token 9304
  # "inth"; Top-100-Abdeckung im ersten Schritt 0,05788).
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: GPT-2 zeigt die Modelle des Manifests
    Wenn ich GPT-2 wähle
    Dann hat die Auswahl "GPT-2-Modell" die Option "Tiny GPT-2 (Test)"

  Szenario: Ohne Manifest ein Hinweis
    Angenommen "models/index.json" antwortet mit 404
    Wenn ich GPT-2 wähle
    Dann zeigt die Gruppe "Engine" den Text "Keine GPT-2-Gewichte gefunden. Mit „npm run fetch-model -- distilgpt2“ herunterladen."

  Szenario: Lauf mit dem Testmodell
    Angenommen ich habe GPT-2 gewählt
    Wenn ich erzeuge
    Dann hat die Gruppe "Zeitleiste" 3 Knöpfe und die Gruppe "Stationen" 12 Knöpfe
    Und zeigt die Region "Erzeugter Text" "Die Katze sitztinthinthinth"
    Und enthält die Station "attention · Layer 0" den Text "weights [2, 6, 6]"
    Und enthält in Schritt 1 die Station "attention · Layer 1" den Text "weights [2, 1, 7]"

  Szenario: Kandidaten des Testmodells
    Angenommen ich habe GPT-2 gewählt und erzeugt
    Wenn ich in der Gruppe "Stationen" auf "logits" klicke
    Dann hat die Liste "Kandidaten" 10 Einträge, der erste beginnt mit "inth"
    Und zeigt die Region "Station" "Nur die 100 gelieferten Kandidaten, sie decken 5,8 % ab."

  Szenario: BPE-Schritte in der tokenize-Station
    Angenommen ich habe GPT-2 gewählt und erzeugt
    Wenn ich in der Gruppe "Stationen" auf "tokenize" klicke
    Dann zeigt die Region "Station" den Hinweis "Wähle ein Token, um seine BPE-Schritte zu sehen."

  Szenario: Fortschritt beim Laden der Gewichte
    Angenommen ich habe GPT-2 gewählt und die Antwort auf "tiny/model.safetensors" wird zurückgehalten
    Wenn ich erzeuge
    Dann zeigt die Seite "Lade Gewichte: 0,0 von 1,6 MB" und den Knopf "Abbrechen"
    Wenn die Antwort freigegeben wird
    Dann hat die Gruppe "Zeitleiste" 3 Knöpfe

  Szenario: Abbrechen beim Laden
    Angenommen ich habe GPT-2 gewählt und die Antwort auf "tiny/model.safetensors" wird zurückgehalten
    Wenn ich erzeuge und auf "Abbrechen" klicke
    Dann gibt es keinen Knopf "Abbrechen", keine Meldung mit role="alert" und keine Region "Wiedergabe"

  Szenario: Gewichte werden nur einmal geladen
    Angenommen ich habe GPT-2 gewählt und erzeugt
    Wenn ich erneut erzeuge, die Seite neu lade, GPT-2 wähle und noch einmal erzeuge
    Dann ging genau eine Anfrage an "tiny/model.safetensors"
    Und zeigt die Region "Erzeugter Text" "Die Katze sitztinthinthinth"

  Szenario: Gewichte nicht gefunden
    Angenommen ich habe GPT-2 gewählt und "tiny/model.safetensors" antwortet mit 404
    Wenn ich erzeuge
    Dann zeigt eine Meldung mit role="alert" "Erzeugen fehlgeschlagen: Die Gewichte konnten nicht geladen werden (HTTP 404)."

  Szenario: Ungültige Gewichtsdatei
    Angenommen ich habe GPT-2 gewählt und "tiny/model.safetensors" liefert den Text "kaputt"
    Wenn ich erzeuge
    Dann beginnt die Meldung mit role="alert" mit "Erzeugen fehlgeschlagen: Die Gewichtsdatei ist ungültig: "

  Szenario: Zurück zum Mock
    Angenommen ich habe GPT-2 gewählt und erzeugt
    Wenn ich in der Gruppe "Engine" "Mock" wähle und "die katze sitzt" mit Max. Tokens 2 erzeuge
    Dann zeigt die Region "Erzeugter Text" nicht "inth"
    Und hat die Gruppe "Stationen" 12 Knöpfe
