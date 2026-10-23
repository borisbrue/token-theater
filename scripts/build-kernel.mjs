// Übersetzt src/engine/gpt2/kernel.wat mit wabt nach src/engine/gpt2/kernel-wasm.ts
// (SPEC-0008 §3.5, CON-0019 K-07). Aufruf: npm run build:kernel
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import wabtInit from 'wabt';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'engine', 'gpt2');
const source = await readFile(join(dir, 'kernel.wat'), 'utf8');
const wabt = await wabtInit();
const parsed = wabt.parseWat('kernel.wat', source, { simd: true, bulk_memory: true });
let bytes;
try {
  bytes = parsed.toBinary({}).buffer;
} finally {
  parsed.destroy();
}
const base64 = Buffer.from(bytes).toString('base64');
const code = `// Generiert von scripts/build-kernel.mjs aus kernel.wat – nicht von Hand ändern (SPEC-0008).
/** Das WASM-Modul des Rechenkerns (${bytes.length} Byte) als Base64. */
export const KERNEL_WASM_BASE64 = '${base64}';
`;
const target = join(dir, 'kernel-wasm.ts');
const options = (await prettier.resolveConfig(target)) ?? {};
await writeFile(target, await prettier.format(code, { ...options, filepath: target }));
process.stdout.write(`kernel-wasm.ts: ${bytes.length} Byte\n`);
