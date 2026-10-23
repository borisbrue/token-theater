import { useState } from 'react';

import { listModels } from '../engine-factory';
import {
  normalizeBaseUrl,
  PRESETS,
  type DialectChoice,
  type StoredSettings,
} from '../remote-settings';
import { texts } from '../texts';
import type { ModelEntry } from '../gpt2/models';

const labels = texts.remote;
const DIALECTS: readonly DialectChoice[] = ['auto', 'legacy', 'content'];
const OWN_PROFILE = '';
const MODELS_LIST_ID = 'remote-models';

export type EngineKind = 'mock' | 'mock-moe' | 'remote' | 'gpt2';

export interface EngineSettingsProps {
  engine: EngineKind;
  onEngine: (engine: EngineKind) => void;
  settings: StoredSettings;
  onSettings: (settings: StoredSettings) => void;
  apiKey: string;
  onApiKey: (apiKey: string) => void;
  /** null: Manifest wird noch geladen. */
  gpt2Models: readonly ModelEntry[] | null;
  gpt2Model: string;
  onGpt2Model: (id: string) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Gruppe „Engine“ im Formular (SPEC-0005 §3.7, SPEC-0006 §3.8): Mock, Server oder GPT-2. */
export function EngineSettings(props: EngineSettingsProps) {
  const { engine, onEngine, settings, onSettings, apiKey, onApiKey } = props;
  const { gpt2Models, gpt2Model, onGpt2Model } = props;
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  function update(change: Partial<StoredSettings>) {
    onSettings({ ...settings, ...change });
  }

  function chooseProfile(name: string) {
    const preset = PRESETS.find((p) => p.name === name);
    if (preset === undefined) {
      update({ profile: OWN_PROFILE });
      return;
    }
    update({
      profile: preset.name,
      baseUrl: preset.baseUrl,
      model: preset.model ?? '',
      dialect: preset.dialect ?? 'auto',
    });
    onApiKey(preset.apiKey ?? '');
  }

  async function loadModels() {
    setStatus(labels.loadingModels);
    try {
      const found = await listModels({ baseUrl: normalizeBaseUrl(settings.baseUrl), apiKey });
      setModels(found);
      setStatus(labels.modelsFound(found.length));
    } catch (error) {
      setModels([]);
      setStatus(messageOf(error));
    }
  }

  return (
    <fieldset className="engine">
      <legend>{labels.group}</legend>
      <div className="strategy">
        <label>
          <input
            type="radio"
            name="engine"
            checked={engine === 'mock'}
            onChange={() => onEngine('mock')}
          />
          {labels.mock}
        </label>
        <label>
          <input
            type="radio"
            name="engine"
            checked={engine === 'mock-moe'}
            onChange={() => onEngine('mock-moe')}
          />
          {labels.mockMoe}
        </label>
        <label>
          <input
            type="radio"
            name="engine"
            checked={engine === 'remote'}
            onChange={() => onEngine('remote')}
          />
          {labels.server}
        </label>
        <label>
          <input
            type="radio"
            name="engine"
            checked={engine === 'gpt2'}
            onChange={() => onEngine('gpt2')}
          />
          {texts.gpt2.engine}
        </label>
      </div>
      {engine === 'gpt2' && gpt2Models !== null && gpt2Models.length === 0 && (
        <p className="hint engine-hint">{texts.gpt2.noModels}</p>
      )}
      {engine === 'gpt2' && gpt2Models !== null && gpt2Models.length > 0 && (
        <>
          <label htmlFor="gpt2-model">{texts.gpt2.model}</label>
          <select id="gpt2-model" value={gpt2Model} onChange={(e) => onGpt2Model(e.target.value)}>
            {gpt2Models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </>
      )}
      {engine === 'remote' && (
        <>
          <label htmlFor="remote-profile">{labels.profile}</label>
          <select
            id="remote-profile"
            value={settings.profile}
            onChange={(e) => chooseProfile(e.target.value)}
          >
            <option value={OWN_PROFILE}>{labels.ownProfile}</option>
            {PRESETS.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
          <label htmlFor="remote-base-url">{labels.baseUrl}</label>
          <input
            id="remote-base-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={settings.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
          <label htmlFor="remote-api-key">{labels.apiKey}</label>
          <input
            id="remote-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => onApiKey(e.target.value)}
          />
          <label htmlFor="remote-model">{labels.model}</label>
          <input
            id="remote-model"
            type="text"
            autoComplete="off"
            list={MODELS_LIST_ID}
            value={settings.model}
            onChange={(e) => update({ model: e.target.value })}
          />
          <datalist id={MODELS_LIST_ID}>
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <label htmlFor="remote-dialect">{labels.dialect}</label>
          <select
            id="remote-dialect"
            value={settings.dialect}
            onChange={(e) =>
              update({ dialect: DIALECTS.find((d) => d === e.target.value) ?? 'auto' })
            }
          >
            {DIALECTS.map((dialect) => (
              <option key={dialect} value={dialect}>
                {labels.dialects[dialect]}
              </option>
            ))}
          </select>
          <div className="engine-actions">
            <button type="button" onClick={() => void loadModels()}>
              {labels.loadModels}
            </button>
            <span className="hint">{status}</span>
          </div>
        </>
      )}
    </fieldset>
  );
}
