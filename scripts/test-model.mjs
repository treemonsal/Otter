import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const directory = await mkdtemp(join(tmpdir(), 'murmur-model-'));
const fixture = join(directory, 'jfk.wav');
// Public-domain JFK speech sample, hosted by Transformers.js documentation.
execFileSync('curl', [
  '--fail',
  '--silent',
  '--show-error',
  '--location',
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav',
  '--output',
  fixture,
]);
const revision = '5332fcc35e32a33b86612b9a57a89be7906102b1';
const metadata = JSON.parse(
  execFileSync(
    'curl',
    [
      '-fsSL',
      `https://huggingface.co/api/models/Xenova/whisper-tiny/revision/${revision}?blobs=true`,
    ],
    { encoding: 'utf8' },
  ),
);
const files = new Map(metadata.siblings.map((file) => [file.rfilename, file]));
const downloaded = new Map();
const run = promisify(execFile);
const browser = await chromium.launch({
  ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          if (event.data?.type === 'error') console.error('Whisper worker:', event.data.message);
        });
      }
    };
  });
  page.on('requestfailed', (r) =>
    console.error(
      'Request failed:',
      new URL(r.url()).host + new URL(r.url()).pathname,
      r.failure()?.errorText,
    ),
  );
  page.on('response', (r) => {
    if (r.status() >= 400)
      console.error('HTTP:', r.status(), new URL(r.url()).host + new URL(r.url()).pathname);
  });
  // The cloud browser does not trust the environment's proxy CA. Keep its
  // trust store unchanged: relay only authentic, hash-verified model files
  // downloaded with curl's existing TLS trust. No inference is mocked.
  await page.route('https://huggingface.co/**', async (route) => {
    const requestURL = new URL(route.request().url());
    const prefix = `/Xenova/whisper-tiny/resolve/${revision}/`;
    if (!requestURL.pathname.startsWith(prefix))
      throw new Error('Unexpected unpinned model URL: ' + requestURL.pathname);
    const filename = requestURL.pathname.slice(prefix.length);
    const entry = files.get(filename);
    if (!entry) {
      await route.fulfill({ status: 404, body: 'Not found' });
      return;
    }
    if (!downloaded.has(filename))
      downloaded.set(
        filename,
        (async () => {
          const path = join(directory, createHash('sha256').update(filename).digest('hex'));
          await run('curl', [
            '--fail',
            '--silent',
            '--show-error',
            '--location',
            requestURL.href,
            '--output',
            path,
          ]);
          const body = await readFile(path);
          if (entry.lfs)
            expect(createHash('sha256').update(body).digest('hex')).toBe(entry.lfs.sha256);
          else
            expect(
              createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'),
            ).toBe(entry.blobId);
          return body;
        })(),
      );
    const body = await downloaded.get(filename);
    await route.fulfill({
      status: 200,
      body,
      contentType: filename.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      headers: { 'access-control-allow-origin': '*', 'content-length': String(body.length) },
    });
  });
  const requests = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('blob:'))
      requests.push({ host: new URL(r.url()).hostname, method: r.method() });
  });
  page.on('pageerror', (e) => console.error('Browser error:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('Browser:', m.text().slice(0, 600));
  });
  await page.goto('http://127.0.0.1:4173/Otter/');
  await expect(page.getByRole('heading', { name: 'Deine Gespräche.' })).toBeVisible();
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await page.locator('.setting-select select').selectOption('english');
  await page.locator('input[type=file][accept^="audio"]').setInputFiles(fixture);
  await expect(page.locator('audio')).toBeVisible();
  if (requests.length) throw new Error('External requests occurred before model consent');
  await page.getByRole('button', { name: 'Transkription starten', exact: true }).click();
  await page.getByRole('button', { name: /Auf diesem Gerät/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Erlauben & starten' }).click();
  let last = '';
  const progress = setInterval(async () => {
    const text = await page
      .locator('.processing-banner strong')
      .textContent()
      .catch(() => null);
    if (text && text !== last) {
      console.log(text);
      last = text;
    }
  }, 2500);
  try {
    await expect
      .poll(
        async () => {
          const error = await page
            .locator('.error-box')
            .textContent()
            .catch(() => null);
          if (error) throw new Error(error);
          return await page.locator('.segment-body p').allTextContents();
        },
        { timeout: 240000, intervals: [1500] },
      )
      .not.toHaveLength(0);
  } finally {
    clearInterval(progress);
  }
  const result = (await page.locator('.segment-body p').allTextContents()).join(' ').toLowerCase();
  expect(result).toContain('country');
  expect(result).toContain('ask');
  console.log('Online inference passed:', result);
  const outboundWrites = requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
  expect(outboundWrites).toEqual([]);
  console.log('External requests were model GET/HEAD requests only:', [
    ...new Set(requests.map((r) => r.host)),
  ]);
  // Recreate the worker while offline, proving model and WASM cache suffices.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.unroute('https://huggingface.co/**');
  await context.setOffline(true);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Erneut transkribieren' }).click();
  await page.getByRole('button', { name: /Auf diesem Gerät/ }).click();
  await expect(page.locator('.processing-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Textstelle 1 bearbeiten' }).click();
  await page.getByLabel('Gesprochener Text').fill('Meine manuelle Korrektur bleibt erhalten.');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.processing-banner')).toHaveCount(0, { timeout: 180000 });
  await expect(
    page.getByRole('dialog', { name: 'Deine Korrekturen bleiben erhalten.' }),
  ).toBeVisible();
  await expect(page.locator('.segment-body p').first()).toHaveText(
    'Meine manuelle Korrektur bleibt erhalten.',
  );
  const newResult = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Neues Ergebnis exportieren' }).click();
  const output = await readFile(await (await newResult).path(), 'utf8');
  expect(output.toLowerCase()).toContain('country');
  await expect(page.locator('.error-box')).toHaveCount(0);
  await expect(page.locator('.segment-body p').first()).toHaveText(
    'Meine manuelle Korrektur bleibt erhalten.',
  );
  console.log('Offline inference and preservation of manual corrections passed with a new worker.');
  await context.close();
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
