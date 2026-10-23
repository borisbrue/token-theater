// Lädt GPT-2-Gewichte von Hugging Face nach public/models/<id>/ und trägt sie in
// public/models/index.json ein (SPEC-0006 §3.3, FR-08). Aufruf: npm run fetch-model -- distilgpt2
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const MODELS = {
  distilgpt2: { repo: 'distilbert/distilgpt2', name: 'DistilGPT-2 (82M, 6 Layer)' },
  gpt2: { repo: 'openai-community/gpt2', name: 'GPT-2 small (124M, 12 Layer)' },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const out = process.stdout;

async function download(url, target) {
  const response = await globalThis.fetch(url);
  if (!response.ok || response.body === null) throw new Error(`${url}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  let loaded = 0;
  let shown = -1;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    loaded += chunk.length;
    const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
    if (percent !== shown) {
      shown = percent;
      out.write(`\r  ${target.split('/').slice(-2).join('/')}: ${percent} %`);
    }
  });
  await pipeline(body, createWriteStream(`${target}.part`));
  await rename(`${target}.part`, target);
  out.write('\n');
  return loaded;
}

async function readManifest() {
  try {
    const parsed = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
    return Array.isArray(parsed.models) ? parsed : { models: [] };
  } catch {
    return { models: [] };
  }
}

async function main() {
  const id = process.argv[2];
  const model = MODELS[id];
  if (model === undefined) {
    out.write(`Unbekanntes Modell "${id ?? ''}". Verfügbar: ${Object.keys(MODELS).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  const base = `https://huggingface.co/${model.repo}/resolve/main`;
  out.write(`Lade ${model.repo} nach public/models/${id}/\n`);
  await download(`${base}/config.json`, join(dir, 'config.json'));
  const bytes = await download(`${base}/model.safetensors`, join(dir, 'model.safetensors'));
  const manifest = await readManifest();
  const entry = {
    id,
    name: model.name,
    config: `${id}/config.json`,
    weights: `${id}/model.safetensors`,
    bytes,
  };
  manifest.models = [...manifest.models.filter((m) => m.id !== id), entry];
  await writeFile(join(root, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  out.write(`Fertig: ${model.name} steht in public/models/index.json.\n`);
}

await main();
