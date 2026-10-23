# Token Theater

Eine Web-App, die zeigt, was ein Sprachmodell Schritt für Schritt tut – verlangsamt, zum
Vortragen und Selbstlernen. Die Oberfläche ist auf Deutsch.

Eine Engine rechnet in normalem Tempo und schreibt jeden Zwischenschritt in einen **Trace**. Ein
Playback-Controller spielt ihn ab wie ein Video: abspielen, anhalten, Station für Station vor und
zurück, Tempo wählen.

**Online ausprobieren:** https://borisbrue.github.io/token-theater/ (lädt beim ersten Start
von GPT-2 rund 350 MB Gewichte; danach aus dem Browser-Cache).

## Was man sieht

- **Tokenizer:** GPT-2-BPE mit jedem Merge-Schritt.
- **Embedding, Attention, MLP, Residual Stream:** Vektoren als Farbstreifen, Attention als
  Heatmap je Kopf, KV-Cache, stärkste Neuronen, Logit-Lens nach jedem Layer.
- **Logits und Sampling:** Wahrscheinlichkeiten der Kandidaten, Greedy oder Zufall mit
  Temperatur, Top-k, Top-p und Seed; ein Sampling-Labor zum Ausprobieren.
- **Mixture of Experts:** Für MoE-Modelle zeigt die Station `moe`, welche Experten der Router
  für jedes Token wählt, mit welchem Gate-Gewicht, und welchen Weg ein Token durch alle Layer
  nimmt.
- **Layer-Karte und Glossar:** Wo die Station im Modell liegt; jeder Fachbegriff lässt sich an Ort
  und Stelle nachschlagen.
- **Vergleich:** Zwei Läufe mit verschiedenen Prompts nebeneinander („The doctor said that“ /
  „The nurse said that“): Unterschiede der Ausgabe in Prozentpunkten, JS-Divergenz und je Layer
  die Kosinus-Ähnlichkeit der letzten Position mit Logit-Lens; der größte Abfall ist markiert.
- **Sonde:** Bericht des Python-Werkzeugs `probe.py` über viele Prompt-Paare. Die App misst und
  zeigt Unterschiede; ob ein Unterschied ein Bias ist, bleibt eine menschliche Bewertung.
- **Präsentationsmodus:** Bühne ohne Formulare, große Schrift, Bedienung per Tastatur oder
  Clicker (`p`, `Esc`, Bild ↑/↓, Pfeiltasten, Leertaste).
- **Smartphone:** Layout ab 360 px Breite, Transportknöpfe unten fixiert, Wischen über die
  Station schaltet weiter, Tippen zeigt Werte in Heatmaps; die Bühne passt hoch und quer.
- **Trace exportieren und importieren** als JSON.

## Engines

| Engine          | Interna                 | Beschreibung                                                                                     |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Mock            | ja                      | Kleines erfundenes Modell, sofort verfügbar                                                      |
| Mock-MoE        | ja                      | Dasselbe mit Mixture of Experts (4 Experten, Top-2)                                              |
| GPT-2 (Browser) | alle                    | Eigene GPT-2-Implementierung in TypeScript im Web Worker, Matrixrechnung in WebAssembly mit SIMD |
| Server          | nur Tokens und Logprobs | OpenAI-kompatible Server (vLLM, MLX, llama.cpp …)                                                |

## Schnellstart

Voraussetzung: Node.js 20 oder neuer.

```sh
npm ci
npm run fetch-model -- distilgpt2   # optional: Gewichte von Hugging Face nach public/models/
npm run dev
```

Dann `http://localhost:5173` öffnen. Ohne Gewichte steht die Mock-Engine zur Verfügung; mit
`npm run fetch-model -- gpt2` kommt GPT-2 small (124M) dazu.

Server-Presets lassen sich über `.env.local` vorgeben, siehe `.env.example`. API-Keys gehören
nicht dorthin: Die App fragt sie ab und speichert sie nicht.

## Echte MoE-Modelle

Ein MoE-Modell im Browser zu rechnen wäre zu groß. Stattdessen nimmt ein Python-Exporter den
Lauf mit Hugging Face `transformers` auf und schreibt einen Trace, den die App über
„Trace importieren“ lädt. Unterstützt sind Granite-MoE und Mixtral. Python-Werkzeuge laufen über
[uv](https://docs.astral.sh/uv/):

```sh
npm run export-moe -- --model ibm-granite/granite-3.1-1b-a400m-base \
  --prompt "Die Katze sitzt auf der" --max-tokens 8 --out granite.trace.json
```

Das Referenzmodell braucht 2,7 GB Download und läuft auf der CPU in wenigen Minuten.

## Sonden und Gewichtsabgleich

```sh
# Prompt-Paare durch ein Modell schicken; den Bericht zeigt die Ansicht „Sonde“
npm run probe -- --model distilgpt2 --probe scripts/probes/occupation-gender-en.probe.json \
  --out occupation.probe-report.json

# SHA-256 der Gewichtsdateien gegen Hugging Face prüfen (Exit 0 ok, 1 abweichend, 3 nicht prüfbar)
npm run verify-weights -- --model distilbert/distilgpt2 --local public/models/distilgpt2

# Zwei Checkpoints Tensor für Tensor vergleichen
npm run verify-weights -- --model ./feingetunt --reference distilbert/distilgpt2 --out diff.json
```

Beispielsonden liegen in `scripts/probes/`: Geschlecht bei Berufen (Englisch, Deutsch), Herkunft
über Vornamen und Alter, je 12 Paare mit einer Kontrolle. Die Sonden messen Unterschiede in der
Ausgabe; sie sind kein Urteil über ein Modell.

## Entwicklung

```sh
npm test            # Unit-Tests (Vitest)
npm run test:e2e    # Akzeptanztests (Playwright, Chromium)
npm run lint        # ESLint und Prettier
npm run build       # Typprüfung und Produktions-Build
npm run build:kernel  # WASM-Rechenkern aus src/engine/gpt2/kernel.wat neu bauen
```

Schichten: `app → views → playback → trace → engine`, Abhängigkeiten zeigen nur nach unten.
Die Anforderungen stehen als Specs in `.sdd/specs/`, die ausführbaren Verträge (Gherkin-Features,
JSON-Schemas, Regeln) in `.sdd/contracts/`; die Tests lesen sie direkt. Entstanden ist das
Projekt mit Spec-Driven Development und [Claude Code](https://claude.com/claude-code).

## Lizenz

[MIT](LICENSE)
