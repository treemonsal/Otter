import { chromium, devices, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const provider = 'https://hf-audio-whisper-large-v3.hf.space';
const origin = 'http://127.0.0.1:4173';
const directory = await mkdtemp(join(tmpdir(), 'murmur-cloud-'));
const browser = await chromium.launch({
  ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
});
try {
  const fixture = join(directory, 'jfk.wav');
  await run('curl', [
    '-fsSL',
    '--max-time',
    '30',
    'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav',
    '-o',
    fixture,
  ]);
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    defaultBrowserType: undefined,
  });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://')) requests.push(r.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  // This cloud Chromium does not trust the injected proxy CA. Do not alter its trust store.
  // Relay ORIGINAL live API responses through curl's verified TLS, including original CORS headers.
  // All uploaded data is the public JFK fixture; inference really runs on the remote provider.
  await page.route(`${provider}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/gradio_api/')) throw new Error('Unexpected cloud path');
    const id = crypto.randomUUID();
    const output = join(directory, id + '.response');
    const headersPath = join(directory, id + '.headers');
    const args = [
      '--silent',
      '--show-error',
      '--max-time',
      '180',
      '--request',
      req.method(),
      '--header',
      `Origin: ${origin}`,
      '--dump-header',
      headersPath,
      '--output',
      output,
      req.url(),
    ];
    const contentType = req.headers()['content-type'];
    if (contentType) args.push('--header', `Content-Type: ${contentType}`);
    const body = req.postDataBuffer();
    if (body) {
      const input = join(directory, id + '.request');
      await writeFile(input, body);
      args.push('--data-binary', '@' + input);
    }
    await run('curl', args);
    const headerBlocks = (await readFile(headersPath, 'utf8')).trim().split(/\r?\n\r?\n/);
    const block = headerBlocks.at(-1);
    const status = Number(block.split(/\r?\n/)[0].split(' ')[1]);
    const headers = {};
    for (const line of block.split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
    }
    expect(headers['access-control-allow-origin']).toBe(origin);
    const responseBody = await readFile(output);
    // Transfer encoding belongs to curl's connection, not the fulfilled browser response.
    delete headers['transfer-encoding'];
    delete headers['content-encoding'];
    delete headers['content-length'];
    console.log('Live API:', req.method(), url.pathname, status);
    await route.fulfill({ status, headers, body: responseBody });
  });
  // Verify the provider's actual browser preflight support, not a manufactured CORS response.
  const { stdout: preflight } = await run('curl', [
    '-sS',
    '--max-time',
    '20',
    '-D',
    '-',
    '-o',
    '/dev/null',
    '-X',
    'OPTIONS',
    provider + '/gradio_api/call/transcribe',
    '-H',
    `Origin: ${origin}`,
    '-H',
    'Access-Control-Request-Method: POST',
    '-H',
    'Access-Control-Request-Headers: content-type',
  ]);
  expect(preflight.toLowerCase()).toContain('access-control-allow-origin: ' + origin);
  expect(preflight.toLowerCase()).toContain('access-control-allow-methods:');
  await page.goto(origin + '/Otter/');
  await expect(page.getByRole('heading', { name: 'Deine Gespräche.' })).toBeVisible();
  await page.locator('input[type=file][accept^="audio"]').setInputFiles(fixture);
  await expect(page.locator('audio')).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Transkription starten', exact: true }).click();
  await page.getByRole('button', { name: 'Online transkribieren', exact: true }).click();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Audio senden & starten' }).click();
  await expect
    .poll(
      async () => {
        const error = await page
          .locator('.error-box')
          .textContent({ timeout: 100 })
          .catch(() => null);
        if (error) throw new Error(error);
        return page.locator('.segment-body p').allTextContents();
      },
      { timeout: 200000, intervals: [1000] },
    )
    .not.toHaveLength(0);
  const result = (await page.locator('.segment-body p').allTextContents()).join(' ').toLowerCase();
  expect(result).toContain('fellow americans');
  expect(result).toContain('country');
  expect(requests).toHaveLength(3);
  expect(requests.every((url) => new URL(url).origin === provider)).toBe(true);
  await expect(page.locator('.transcription-source')).toContainText('Whisper large v3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.segment-body p')).toContainText('country');
  await page.screenshot({ path: '/tmp/murmur-cloud-mobile.png', fullPage: true });
  console.log('Actual remote inference, mobile layout and persisted result passed:', result);
  console.log(
    'Provider CORS verified over TLS. Browser trust store unchanged; direct browser-provider TLS was not tested.',
  );
  await context.close();
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
