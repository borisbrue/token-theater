# language: de
Funktionalität: Echtes Modell über einen OpenAI-kompatiblen Server
  Als Vortragende/r oder Lernende/r
  möchte ich den Prompt an ein echtes Sprachmodell schicken und dessen Verteilungen abspielen
  um zu sehen, welche Tokens ein echtes Modell erwägt

  # Fake-Server: Playwright fängt "<Origin>/fake-llm/v1/**" ab (eigener Origin). GET .../models
  # liefert tests/fixtures/remote/models-legacy.json. POST .../completions liefert bei
  # "echo": true legacy-echo.json, bei "logprobs": true content-step.json, sonst legacy-step.json;
  # einzelne Szenarien überschreiben Antworten. "URL" = "<Origin>/fake-llm/v1".
  # "Server einstellen (D)" = in der Gruppe "Engine" "Server" wählen, "Basis-URL" = URL,
  # "API-Key" = "sk-test-123", "Modell" = "Qwen3.5-0.8B", "Dialekt" = D.
  # "Erzeugen" = Prompt "Die Katze sitzt auf dem", Max. Tokens 3, Knopf "Erzeugen".
  # Die Presets kommen aus VITE_REMOTE_PRESETS, das playwright.config.ts beim Build setzt:
  # "Test-vLLM" (URL, Modell "Qwen3.5-0.8B", Dialekt legacy, ohne Key) und
  # "Test-MLX" (URL, Modell "mlx-test", Dialekt content, Key "sk-optiq-test").
  Grundlage:
    Angenommen die App ist unter "/" geöffnet

  Szenario: Mock ist voreingestellt
    Dann ist in der Gruppe "Engine" die Option "Mock" gewählt
    Und gibt es kein Feld "Basis-URL"

  Szenario: Server zeigt die Einstellungen
    Wenn ich in der Gruppe "Engine" die Option "Server" wähle
    Dann sehe ich die Felder "Basis-URL", "API-Key" (Passwortfeld) und "Modell"
    Und hat die Auswahl "Dialekt" die Optionen "Automatisch", "Klassisch (vLLM)" und "Logprobs-Liste (MLX)"
    Und hat die Auswahl "Profil" die Optionen "Eigene Angaben", "Test-vLLM" und "Test-MLX"
    Und gibt es den Knopf "Modelle laden"

  Szenario: Profil füllt die Felder
    Wenn ich "Server" wähle und im Profil "Test-MLX" wähle
    Dann ist "Basis-URL" die URL, "Modell" "mlx-test", "Dialekt" "Logprobs-Liste (MLX)" und "API-Key" "sk-optiq-test"
    Wenn ich im Profil "Test-vLLM" wähle
    Dann ist "Modell" "Qwen3.5-0.8B", "Dialekt" "Klassisch (vLLM)" und "API-Key" leer

  Szenario: Modelle laden
    Angenommen der Server ist eingestellt (Automatisch)
    Wenn ich auf "Modelle laden" klicke
    Dann zeigt die Gruppe "Engine" den Text "12 Modelle gefunden"
    Und ging an "URL/models" ein GET mit dem Header Authorization "Bearer sk-test-123"

  Szenario: Modelle laden mit falschem Key
    Angenommen der Server ist eingestellt (Automatisch) und GET .../models antwortet mit 401
    Wenn ich auf "Modelle laden" klicke
    Dann zeigt die Gruppe "Engine" den Text "Der Server hat den API-Key abgelehnt (HTTP 401)."

  Szenario: Lauf im Dialekt Klassisch
    Angenommen der Server ist eingestellt (Klassisch (vLLM))
    Wenn ich erzeuge
    Dann hat die Gruppe "Zeitleiste" 3 Knöpfe und die Gruppe "Stationen" die Knöpfe "tokenize", "logits" und "sample"
    Und zeigt die Region "Erzeugter Text" "Die Katze sitzt auf dem Sofa Sofa Sofa"
    Und gingen 4 Anfragen an "URL/completions", die erste mit "echo": true
    Und hatte jede Anfrage den Header Authorization "Bearer sk-test-123" und im Body "model" "Qwen3.5-0.8B", "max_tokens" 1 und "logprobs" 20

  Szenario: Kandidaten eines echten Modells
    Angenommen der Server ist eingestellt (Klassisch (vLLM)) und ich habe erzeugt
    Wenn ich in der Gruppe "Stationen" auf "logits" klicke
    Dann hat die Liste "Kandidaten" 5 Einträge, der erste enthält "␣Sofa", "55,9 %" und "–"
    Und zeigt die Region "Station" "Nur die 5 gelieferten Kandidaten, sie decken 43,7 % ab."
    Wenn ich in der Gruppe "Stationen" auf "tokenize" klicke
    Dann hat die Liste "Tokens" der Region "Station" die Einträge "Die 0", "␣Kat 1", "ze 2", "␣sitzt 3", "␣auf 4" und "␣dem 5"

  Szenario: Lauf im Dialekt Logprobs-Liste
    Angenommen der Server ist eingestellt (Logprobs-Liste (MLX))
    Wenn ich erzeuge
    Dann hat die Gruppe "Stationen" die Knöpfe "logits" und "sample"
    Und zeigt die Region "Erzeugter Text" "Die Katze sitzt auf dem Dach Dach Dach"
    Und gingen 3 Anfragen an "URL/completions", jede mit "logprobs": true und "top_logprobs" 10
    Und ist der erste Eintrag der Region "Tokenstrom" "Die␣Katze␣sitzt␣auf␣dem" (Leerraum sichtbar, CON-0020)

  Szenario: Dialekt wird automatisch erkannt
    Angenommen der Server ist eingestellt (Automatisch) und POST .../completions antwortet immer mit content-step.json
    Wenn ich erzeuge
    Dann hat die Gruppe "Stationen" die Knöpfe "logits" und "sample"
    Und war die erste Anfrage an "URL/completions" eine Probe mit "prompt" "Hallo" und "top_logprobs" 1

  Szenario: Zufall mit dem Server ist reproduzierbar
    Angenommen der Server ist eingestellt (Klassisch (vLLM)) und Sampling "Zufall" mit Seed "7"
    Wenn ich erzeuge, die Seite neu lade, dasselbe einstelle und erneut erzeuge
    Dann ist der Text der Region "Erzeugter Text" beide Male gleich
    Und zeigt die Station "sample" einen Text "Zufallszahl 0,…"

  Szenario: Falscher Key beim Lauf
    Angenommen der Server ist eingestellt (Klassisch (vLLM)) und POST .../completions antwortet mit 401
    Wenn ich erzeuge
    Dann zeigt eine Meldung mit role="alert" "Erzeugen fehlgeschlagen: Der Server hat den API-Key abgelehnt (HTTP 401)."

  Szenario: Fehler mitten im Lauf
    Angenommen der Server ist eingestellt (Klassisch (vLLM)) und die dritte Anfrage an .../completions antwortet mit 429
    Wenn ich erzeuge
    Dann zeigt eine Meldung mit role="alert" "Der Lauf wurde abgebrochen: Der Server begrenzt die Anfragen (HTTP 429). Bitte kurz warten."
    Und hat die Gruppe "Zeitleiste" 1 Knopf

  Szenario: Server nicht erreichbar
    Angenommen der Server ist eingestellt (Logprobs-Liste (MLX)) und Anfragen an .../completions werden abgebrochen
    Wenn ich erzeuge
    Dann zeigt eine Meldung mit role="alert" "Der Lauf wurde abgebrochen: Der Server ist nicht erreichbar (URL)."
    Und gibt es keine Region "Wiedergabe"

  Szenario: Fortschritt und Abbrechen
    Angenommen der Server ist eingestellt (Logprobs-Liste (MLX)) und die zweite Anfrage an .../completions wird zurückgehalten
    Wenn ich mit Max. Tokens 5 erzeuge
    Dann zeigt die Seite "Schritt 2 von 5" und den Knopf "Abbrechen"
    Wenn ich auf "Abbrechen" klicke
    Dann gibt es keinen Knopf "Abbrechen" und keine Meldung mit role="alert"
    Und hat die Gruppe "Zeitleiste" 1 Knopf

  Szenario: Der API-Key wird nicht gespeichert
    Angenommen der Server ist eingestellt (Klassisch (vLLM))
    Wenn ich die Seite neu lade und "Server" wähle
    Dann ist "Basis-URL" die URL, "Modell" "Qwen3.5-0.8B" und "Dialekt" "Klassisch (vLLM)"
    Und ist "API-Key" leer
    Und enthalten localStorage und sessionStorage nirgends "sk-test-123"

  Szenario: Export eines Server-Traces enthält keinen Key
    Angenommen der Server ist eingestellt (Klassisch (vLLM)) und ich habe erzeugt
    Wenn ich den Trace exportiere
    Dann ist engine.kind "remote-legacy" und die Datei enthält nicht "sk-test-123"

  Szenario: Zurück zum Mock
    Angenommen der Server ist eingestellt (Klassisch (vLLM))
    Wenn ich in der Gruppe "Engine" "Mock" wähle und "die katze sitzt" mit Max. Tokens 2 erzeuge
    Dann hat die Gruppe "Stationen" 12 Knöpfe
    Und ging keine Anfrage an "URL/completions"
