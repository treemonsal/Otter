import { mkdir, copyFile, rm, readFile } from 'node:fs/promises';
await rm('public/ort', { recursive: true, force: true });
const { version } = JSON.parse(await readFile('node_modules/onnxruntime-web/package.json', 'utf8'));
await mkdir(`public/ort/${version}`, { recursive: true });
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(`node_modules/onnxruntime-web/dist/${file}`, `public/ort/${version}/${file}`);
}
