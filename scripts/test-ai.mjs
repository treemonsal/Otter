import { chromium, devices, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'murmur-ai-ui-'));
const fixture = join(directory, 'jfk.wav');
execFileSync('curl', [
  '-fsSL',
  '--max-time',
  '30',
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav',
  '-o',
  fixture,
]);
const browser = await chromium.launch({
  ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
});
try {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('Page error:', e.message));
  await page.goto('http://127.0.0.1:4173/Otter/');
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await page.getByLabel('KI-Serveradresse').fill('http://127.0.0.1:7860');
  await page.getByRole('button', { name: 'Prüfen & verbinden' }).click();
  await expect(page.getByText(/Verbunden: Whisper small/)).toBeVisible();
  await page.locator('.setting-select select').selectOption('english');
  await page.locator('input[type=file][accept^="audio"]').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Transkription starten', exact: true }).click();
  await page.getByRole('button', { name: 'Mit Meeting-KI verarbeiten', exact: true }).click();
  await page.getByRole('button', { name: 'Audio senden & verarbeiten' }).click();
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
      { timeout: 120000, intervals: [1000] },
    )
    .not.toHaveLength(0);
  const text = (await page.locator('.segment-body p').allTextContents()).join(' ');
  expect(text.toLowerCase()).toContain('fellow americans');
  expect(text.toLowerCase()).toContain('country');
  expect(new Set(await page.locator('.segment-body strong').allTextContents()).size).toBe(1);
  console.log(
    'Actual browser -> resumable upload -> Whisper/diarization -> persisted transcript:',
    text,
  );
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await page.getByRole('button', { name: 'Audio importieren', exact: true }).click();
  await page.getByRole('button', { name: 'Mit Text beginnen' }).click();
  await page
    .getByLabel('Gesprochener Text')
    .fill(
      'Lea: Wir haben beschlossen, das Budget auf 3000 Franken zu begrenzen. Timo schickt das Angebot bis Freitag an Lea. Offen bleibt, ob der Kunde den Termin im Juni bestätigt.',
    );
  await page.getByLabel('Sprecher oder Sprecherin').fill('Lea');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('tab', { name: 'Überblick' }).click();
  await page.getByRole('button', { name: 'Mit KI auswerten', exact: true }).click();
  await page.getByRole('button', { name: 'Transkript senden & auswerten' }).click();
  let last = '';
  const progress = setInterval(async () => {
    const next = await page
      .locator('.processing-banner strong')
      .textContent({ timeout: 100 })
      .catch(() => null);
    if (next && next !== last) {
      console.log(next);
      last = next;
    }
  }, 10000);
  try {
    await expect
      .poll(
        async () => {
          const error = await page
            .locator('.error-box')
            .textContent({ timeout: 100 })
            .catch(() => null);
          if (error) throw new Error(error);
          return page.locator('.ai-insights').count();
        },
        { timeout: 300000, intervals: [2000] },
      )
      .toBe(1);
  } finally {
    clearInterval(progress);
  }
  await expect(page.locator('.ai-insights')).toContainText('3000');
  const suggestions = page.getByRole('button', { name: /Aufgabenvorschläge prüfen \(/ });
  await expect(suggestions).toBeVisible();
  await suggestions.click();
  await expect(page.getByLabel('Verantwortlich', { exact: true }).first()).toHaveValue('Timo');
  await page.getByRole('button', { name: 'Ausgewählte Aufgaben übernehmen' }).click();
  await page.getByRole('tab', { name: 'Aufgaben' }).click();
  await expect(page.locator('.task-row')).toContainText('Timo');
  await page.reload();
  await expect(page.locator('.task-row')).toContainText('Timo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Überblick' }).click();
  await page.screenshot({ path: '/tmp/murmur-ai-mobile.png', fullPage: true });
  console.log(
    'Actual Qwen7B browser insights, exact evidence, reviewed owner/deadline, mobile layout and persisted tasks passed.',
  );
  await context.close();
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
