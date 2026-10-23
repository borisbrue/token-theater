import type { Station } from '../trace/types';
import { formatInteger } from '../views/distribution/format';
import type { ModelFacts } from '../views/station/explanation';
import type { LayerPlace } from '../views/station/layer-map';
import { GLOSSARY, TERMS_BY_STATION } from './glossary-texts';

/** Satz mit Zahl nur, wenn das Modell bekannt ist (SPEC-0009 §3.4). */
const withFacts = (facts: ModelFacts | null, sentence: (f: ModelFacts) => string): string =>
  facts === null ? '' : ` ${sentence(facts)}`;

/** Ausführliche Erklärtexte „Mehr dazu“ je Station (SPEC-0009 §3.4, CON-0020). */
function moreAbout(station: Station, facts: ModelFacts | null): string {
  switch (station.kind) {
    case 'tokenize':
      return (
        'Zerlegt wird mit [[bpe|Byte-Pair-Encoding]]: Häufige Zeichenfolgen sind zu einem Token verschmolzen, seltene Wörter bestehen aus mehreren Stücken. Ein Leerzeichen gehört zum folgenden Wort und erscheint als „␣“.' +
        withFacts(facts, (f) => `Das Vokabular hat ${formatInteger(f.vocabSize)} Tokens.`)
      );
    case 'embed':
      return (
        'Das [[embedding|Token-Embedding]] ist eine Zeile aus einer großen gelernten Tabelle, eine Zeile je Token. Das Positions-Embedding stammt aus einer zweiten Tabelle, eine Zeile je Position. Beide werden addiert; die Summe ist der Anfang des [[residual|Residual Stream]].' +
        withFacts(facts, (f) => `Jeder Vektor hat ${formatInteger(f.dModel)} Zahlen.`)
      );
    case 'attention':
      return (
        'Jedes Token bildet drei Vektoren: eine Frage ([[qkv|Query]]), ein Erkennungszeichen (Key) und einen Inhalt (Value). Passt die Frage eines Tokens zum Erkennungszeichen eines früheren, übernimmt es viel von dessen Inhalt. Spätere Tokens sind ausgeblendet ([[mask|kausale Maske]]). Keys und Values früherer Tokens bleiben gespeichert ([[kvCache|KV-Cache]]), deshalb rechnet jeder neue Schritt nur eine Zeile.' +
        withFacts(
          facts,
          (f) =>
            `Dieses Modell hat ${formatInteger(f.nHeads)} Köpfe in jedem seiner ${formatInteger(f.nLayers)} Layer.`,
        )
      );
    case 'residual':
      return station.after === 'attention'
        ? 'Der [[residual|Residual Stream]] ist wie ein Notizblock, der durch alle [[layer|Layer]] gereicht wird. Die Attention schreibt ihr Ergebnis dazu, statt ihn zu ersetzen. So kommt die ursprüngliche Information unverändert bei den späteren Layern an.' +
            withFacts(facts, (f) => `Er hat ${formatInteger(f.dModel)} Dimensionen.`)
        : 'Nach dem [[mlp|MLP]] ist ein Layer fertig; der Strom geht an den nächsten Layer oder, nach dem letzten, an die Ausgabe. Die [[logitLens|Logit-Lens]] zeigt, welches Token das Modell vorhersagen würde, wenn es hier aufhörte.' +
            withFacts(
              facts,
              (f) => `Das Modell hat ${formatInteger(f.nLayers)} Layer, gezählt ab 0.`,
            );
    case 'mlp':
      return (
        'Das MLP arbeitet für jedes Token einzeln: Es vergrößert den Vektor, wendet eine Nichtlinearität an ([[gelu|GELU]]) und verkleinert ihn wieder. Man vermutet darin einen Speicher für Wissen, das das Modell beim Training gelernt hat.' +
        withFacts(
          facts,
          (f) =>
            `Hier: ${formatInteger(f.dModel)} → ${formatInteger(f.dMlp)} → ${formatInteger(f.dModel)} Zahlen.`,
        )
      );
    case 'logits':
      return (
        'Der letzte Vektor wird normiert und mit der Embedding-Tabelle verglichen: Je ähnlicher er der Zeile eines Tokens ist, desto höher dessen Bewertung ([[logit|Logit]]). [[softmax|Softmax]] macht daraus Wahrscheinlichkeiten, die sich zu 100 % addieren.' +
        (facts === null
          ? ' Ist das Modell unbekannt (etwa bei einem Server), kennt der Trace nur die gelieferten Kandidaten.'
          : ` Bewertet werden alle ${formatInteger(facts.vocabSize)} Tokens des Vokabulars.`)
      );
    case 'sample':
      return '[[greedy|Greedy]] nimmt immer das wahrscheinlichste Token. Mit Zufall verändert die [[temperature|Temperatur]] die Verteilung (klein: vorsichtiger, groß: wilder), [[topK|Top-k]] behält nur die k besten Kandidaten und [[topP|Top-p]] die kleinste Gruppe, die zusammen p erreicht. Ausprobieren lässt sich das im Sampling-Labor der logits-Station.';
  }
}

/**
 * Zeile zum Teil im Layer (SPEC-0010 §3.3). Erschöpfend über die Stationsart: eine neue Art ist ein
 * Typfehler. Layer-Stationen bekommen die Lage als Präfix, wenn die Karte sie kennt.
 */
function layerPart(station: Station, place: LayerPlace | null): string {
  const head =
    place === null
      ? ''
      : `[[layer|Layer]] ${place.layer} · Teil ${place.part} von ${place.parts}: `;
  switch (station.kind) {
    case 'tokenize':
    case 'embed':
      return 'Vor den [[layer|Layern]]: Der Text wird zu Vektoren.';
    case 'attention':
      return `${head}Die Attention holt Information von früheren Tokens.`;
    case 'residual':
      return station.after === 'attention'
        ? `${head}Ihr Ergebnis wird zum Residual Stream addiert.`
        : `${head}Sein Ergebnis wird addiert; der Layer ist fertig.`;
    case 'mlp':
      return `${head}Das MLP verarbeitet jedes Token für sich.`;
    case 'logits':
    case 'sample':
      return 'Nach den [[layer|Layern]]: Aus dem letzten Vektor wird das nächste Token.';
    default: {
      const unknown: never = station;
      return unknown;
    }
  }
}

/** Alle sichtbaren Texte der App (SPEC-0001 FR-11, CON-0003 UI-03). */
export const texts = {
  appTitle: 'Token Theater',
  appSubtitle: 'Trace-Inspector: Was ein Sprachmodell Schritt für Schritt tut',
  promptLabel: 'Prompt',
  maxTokensLabel: 'Max. Tokens',
  generate: 'Erzeugen',
  generating: 'Erzeuge …',
  exportTrace: 'Trace exportieren',
  importTrace: 'Trace importieren',
  generatedText: 'Erzeugter Text',
  steps: 'Schritte',
  step: (index: number): string => `Schritt ${index}`,
  layer: 'Layer',
  details: 'Details',
  playback: {
    region: 'Wiedergabe',
    toStart: 'Zum Anfang',
    stepBack: 'Schritt zurück',
    stationBack: 'Station zurück',
    play: 'Abspielen',
    pause: 'Pause',
    stationForward: 'Station vor',
    stepForward: 'Schritt vor',
    toEnd: 'Zum Ende',
    tempo: 'Tempo',
    speed: (speed: number): string => `${speed}×`,
    timeline: 'Zeitleiste',
    stations: 'Stationen',
    shortcuts:
      'Leertaste ▸ abspielen · ← → oder Bild ↑ ↓ Station · ⇧ ← → Schritt · Pos1 / Ende · P Präsentation',
    noInternals:
      'Dieser Lauf zeigt nur Tokens und Wahrscheinlichkeiten. Ein Server liefert keine Interna wie Attention oder MLP; die zeigt die Engine „GPT-2 (Browser)“.',
  },
  presentation: {
    start: 'Präsentation',
    exit: 'Präsentation beenden',
    stage: 'Bühne',
  },
  tokenStream: {
    region: 'Tokenstrom',
    next: 'nächstes Token',
    placeholder: '?',
  },
  station: {
    region: 'Station',
    position: (step: number, station: number, count: number): string =>
      `Schritt ${step} · Station ${station} / ${count}`,
    layer: 'Layer',
    afterAttention: 'nach Attention',
    afterMlp: 'nach MLP',
    tensors: 'Tensoren',
    candidates: 'Kandidaten',
    moreSummary: 'Mehr dazu',
    more: moreAbout,
    layerPart,
    explanations: {
      tokenize:
        'Der Text wird in [[token|Tokens]] zerlegt: Wörter oder Satzzeichen mit einer festen Nummer.',
      embed:
        'Jedes Token wird zu einem [[vector|Zahlenvektor]]. Dazu kommt ein Vektor für seine Position im Satz.',
      attention:
        'Jedes Token schaut auf die Tokens davor und sammelt, was für es wichtig ist. Jeder [[head|Kopf]] achtet auf etwas anderes. In die Zukunft schaut niemand.',
      residual:
        'Das Ergebnis wird zum laufenden [[residual|Datenstrom]] addiert. Nichts geht verloren, es kommt nur etwas hinzu.',
      mlp: 'Ein kleines [[mlp|neuronales Netz]] verarbeitet jedes Token einzeln weiter und verknüpft das Gelernte.',
      logits:
        'Aus dem letzten Vektor entsteht für jedes Wort im [[vocabulary|Vokabular]] eine [[logit|Bewertung]] und daraus eine Wahrscheinlichkeit.',
      sample: 'Aus den [[softmax|Wahrscheinlichkeiten]] wird das nächste Token gewählt.',
    },
  },
  remote: {
    group: 'Engine',
    mock: 'Mock',
    server: 'Server',
    profile: 'Profil',
    ownProfile: 'Eigene Angaben',
    baseUrl: 'Basis-URL',
    apiKey: 'API-Key',
    model: 'Modell',
    dialect: 'Dialekt',
    dialects: {
      auto: 'Automatisch',
      legacy: 'Klassisch (vLLM)',
      content: 'Logprobs-Liste (MLX)',
    },
    loadModels: 'Modelle laden',
    loadingModels: 'Lade Modelle …',
    modelsFound: (count: number): string =>
      count === 1 ? '1 Modell gefunden' : `${count} Modelle gefunden`,
    progress: (step: number, total: number): string => `Schritt ${step} von ${total}`,
    cancel: 'Abbrechen',
    runFailed: (message: string): string => `Der Lauf wurde abgebrochen: ${message}`,
  },
  gpt2: {
    engine: 'GPT-2 (Browser)',
    model: 'GPT-2-Modell',
    noModels:
      'Keine GPT-2-Gewichte gefunden. Mit „npm run fetch-model -- distilgpt2“ herunterladen.',
    loading: (loaded: string, total: string): string => `Lade Gewichte: ${loaded} von ${total} MB`,
    fromCache: 'Gewichte aus dem Browser-Cache',
    httpError: (status: number): string =>
      `Die Gewichte konnten nicht geladen werden (HTTP ${status}).`,
    networkError: 'Die Gewichte konnten nicht geladen werden (Netzwerkfehler).',
  },
  sampling: {
    group: 'Sampling',
    greedy: 'Greedy',
    random: 'Zufall',
    temperature: 'Temperatur',
    topK: 'Top-k',
    topP: 'Top-p',
    seed: 'Seed',
  },
  distribution: {
    candidates: 'Kandidaten',
    noLogit: '–',
    rest: (count: number, percent: string): string =>
      `+ ${count} weitere Tokens mit zusammen ${percent}`,
    coverage: (count: number, percent: string): string =>
      `Nur die ${count} gelieferten Kandidaten, sie decken ${percent} ab.`,
    coverageUnknown: 'Abdeckung der Verteilung unbekannt.',
    lab: {
      region: 'Sampling-Labor',
      temperature: 'Labor-Temperatur',
      topK: 'Labor-Top-k',
      topP: 'Labor-Top-p',
      reset: 'Zurücksetzen',
      list: 'Labor-Verteilung',
      arrow: '→',
      removed: 'entfernt',
      hint: 'Das Labor rechnet nur diese Verteilung um, der Trace bleibt unverändert.',
    },
    strategyGreedy: 'Strategie: Greedy',
    strategyOther: (strategy: string): string => `Strategie: ${strategy}`,
    params: (temperature: string, topK: string, topP: string, seed: number): string =>
      `Temperatur ${temperature} · Top-k ${topK} · Top-p ${topP} · Seed ${seed}`,
    topKOff: 'aus',
    draw: (random: string, token: string): string => `Zufallszahl ${random} fällt auf „${token}“`,
    greedyDraw: (token: string): string =>
      `Greedy: kein Zufall, gewählt wird das wahrscheinlichste Token „${token}“.`,
  },
  stationViews: (() => {
    const shared = {
      position: 'Position',
      positionOption: (position: number, token: string): string => `${position} · ${token}`,
      strip: (title: string, count: number): string => `${title} · ${count} Werte`,
      dimension: (index: number, value: string): string => `Dimension ${index}: ${value}`,
      scale: (limit: string): string => `Skala: ±${limit}`,
      vectors: 'Vektoren',
      norm: (title: string, norm: string): string => `${title} ‖v‖ = ${norm}`,
    };
    return {
      embed: {
        ...shared,
        token: 'Token-Embedding',
        positionEmbedding: 'Positions-Embedding',
        sum: 'Summe',
      },
      attention: {
        ...shared,
        heads: 'Kopf',
        head: (index: number): string => `Kopf ${index}`,
        mean: 'Mittel',
        history: 'Frühere Schritte zeigen',
        kvCache:
          'Nur die neue Zeile wurde berechnet. Die Zeilen darüber stammen aus früheren Schritten (KV-Cache).',
        heatmap: (layer: number, head: string, rows: number, cols: number): string =>
          `Attention · Layer ${layer} · ${head} · ${rows} × ${cols}`,
        attended: 'Beachtete Tokens',
        attendedEntry: (position: number, token: string, percent: string): string =>
          `${position} · ${token} ${percent}`,
        cell: (row: string, col: string, value: string): string => `„${row}“ → „${col}“: ${value}`,
        masked: (row: string, col: string): string => `„${row}“ → „${col}“: maskiert`,
      },
      mlp: {
        ...shared,
        hidden: 'Hidden',
        active: (count: number, total: number): string => `Aktiv (> 0): ${count} von ${total}`,
        neurons: 'Stärkste Neuronen',
        neuron: (index: number, value: string): string => `#${index} ${value}`,
        input: 'Eingang',
        output: 'Ausgang',
      },
      residual: {
        ...shared,
        stream: 'Residual Stream',
        trajectory: 'Verlauf',
        embed: 'embed',
        entry: (layer: number, after: 'attention' | 'mlp'): string =>
          `Layer ${layer} · ${after === 'attention' ? 'nach Attention' : 'nach MLP'}`,
        normEntry: (name: string, norm: string): string => `${name} ‖x‖ = ${norm}`,
        delta: (delta: string): string => `(Δ ${delta})`,
        lens: 'Logit-Lens',
        lensEntry: (token: string, percent: string): string => `${token} ${percent}`,
        lensAfterMlp: 'Die Logit-Lens gibt es nach jedem MLP.',
        noLens: 'Dieser Trace enthält keine Logit-Lens.',
        lensLastPosition: 'Die Logit-Lens gilt für die letzte Position.',
      },
    };
  })(),
  views: {
    group: 'Ansicht',
    run: 'Durchlauf',
    tokenizer: 'Tokenizer',
    glossary: 'Glossar',
  },
  glossary: {
    entries: GLOSSARY,
    byStation: TERMS_BY_STATION,
    termList: 'Begriffe',
    inApp: 'In der App: ',
    region: 'Glossar',
    heading: 'Glossar',
    intro: 'Alle Begriffe, die Token Theater benutzt.',
  },
  layerMap: {
    region: 'Layer-Karte',
    input: 'Eingabe',
    inputShort: 'E',
    output: 'Ausgabe',
    outputShort: 'A',
    layer: (layer: number): string => `Layer ${layer}`,
    layerShort: (layer: number): string => `L${layer}`,
  },
  tokenizer: {
    region: 'Tokenizer',
    textLabel: 'Text',
    defaultText: 'Die Katze schläft auf dem Sofa.',
    stats: 'Kennzahlen',
    chars: (count: number): string => `${count} Zeichen`,
    bytes: (count: number): string => (count === 1 ? '1 Byte' : `${count} Bytes`),
    tokenCount: (count: number): string => (count === 1 ? '1 Token' : `${count} Tokens`),
    ids: 'IDs',
    loading: 'GPT-2-Vokabular wird geladen …',
    loadError: 'Das GPT-2-Vokabular konnte nicht geladen werden.',
    retry: 'Erneut versuchen',
    tokens: 'Tokens',
    hint: 'Wähle ein Token, um seine BPE-Schritte zu sehen.',
    noBpe: 'Dieser Trace enthält keine BPE-Schritte.',
    bpeRegion: 'BPE-Schritte',
    bpeHeading: (word: string): string => `BPE-Schritte für „${word}“`,
    merges: 'Merges',
    start: 'Start',
    merge: (round: number, rank: number): string => `Merge ${round} · Rang ${rank}`,
  },
  status: (step: number, station: number, count: number, name: string): string =>
    `Schritt ${step} · Station ${station} von ${count} · ${name}`,
  errors: {
    parse: 'Die Datei ist kein gültiges JSON.',
    versionMissing: 'Die Datei enthält keine Trace-Version (schemaVersion).',
    versionUnsupported: (version: string): string =>
      `Trace-Version ${version} wird nicht unterstützt.`,
    schema: 'Die Datei entspricht nicht dem Trace-Format.',
    semantic: 'Der Trace ist inkonsistent.',
    more: (count: number): string => `… und ${count} weitere`,
    readFile: 'Die Datei konnte nicht gelesen werden.',
    generate: (message: string): string => `Erzeugen fehlgeschlagen: ${message}`,
  },
} as const;
