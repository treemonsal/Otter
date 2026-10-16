import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
async function textNote(page: Page) {
  await page.getByRole('button', { name: 'Audio importieren', exact: true }).click();
  await page.getByRole('button', { name: 'Mit Text beginnen' }).click();
  await page
    .getByLabel('Gesprochener Text')
    .fill(
      'Das Budget für unser Projekt beträgt 3000 Franken. Ich werde den Zeitplan am Freitag an das Team schicken.',
    );
  await page.getByLabel('Sprecher oder Sprecherin').fill('Timo');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
function wav() {
  const samples = 32000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 440) / 16000) * 2000), 44 + i * 2);
  return buffer;
}
test.beforeEach(async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Deine Gespräche.' })).toBeVisible();
});
test('Transkript, Notizen, Aufgaben und belegte Suche bleiben nach Neustart erhalten', async ({
  page,
}) => {
  await textNote(page);
  await page.getByRole('button', { name: 'Gespräch umbenennen' }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Projektgespräch Zürich');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('tab', { name: 'Überblick' }).click();
  await expect(page.locator('.summary-card')).toContainText('3000 Franken');
  await page.getByRole('tab', { name: 'Aufgaben' }).click();
  await page.getByRole('button', { name: 'Aufgabenvorschläge finden' }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page.locator('.task-row input').check();
  await page.getByRole('tab', { name: 'Notizen' }).click();
  await page.getByRole('button', { name: 'Notiz schreiben' }).click();
  await page
    .getByRole('textbox', { name: 'Notizen', exact: true })
    .fill('Eigene Entscheidung: Budget freigeben.');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('tab', { name: 'Nachschlagen' }).click();
  await page.getByRole('textbox', { name: 'Im Gespräch nachschlagen' }).fill('Budget');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect(page.locator('.evidence-card')).toContainText('3000 Franken');
  await page.getByRole('textbox', { name: 'Im Gespräch nachschlagen' }).fill('Raketenstart');
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keine passende Textstelle.' })).toBeVisible();
  await page.getByLabel('Gesprächsordner').selectOption('Arbeit');
  await page.getByRole('button', { name: 'Favorit umschalten' }).click();
  await page.reload();
  await expect(page.getByText('Projektgespräch Zürich', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Projektgespräch Zürich/ }).click();
  await expect(page.getByLabel('Gesprächsordner')).toHaveValue('Arbeit');
  await expect(page.getByRole('button', { name: 'Favorit umschalten' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('tab', { name: 'Notizen' }).click();
  await expect(page.locator('.notes-text')).toContainText('Budget freigeben');
  await page.getByRole('tab', { name: 'Aufgaben' }).click();
  await expect(page.locator('.task-row input')).toBeChecked();
});
test('Audioimport und vollständige ZIP-Sicherung inklusive sicherer Wiederherstellung', async ({
  page,
}) => {
  await page
    .locator('input[type=file][accept^="audio"]')
    .setInputFiles({ name: 'Original.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.getByRole('heading', { name: 'Original', exact: true })).toBeVisible();
  await expect(page.locator('audio')).toBeVisible();
  await page.getByRole('button', { name: 'Exportieren', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Komplettes Gespräch (.zip)', exact: true }).click();
  const downloaded = await downloadEvent;
  const archivePath = (await downloaded.path())!;
  const zip = unzipSync(await readFile(archivePath));
  const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  expect(manifest.meetings).toHaveLength(1);
  expect(Buffer.from(zip[`audio/${manifest.meetings[0].id}`])).toEqual(wav());
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'In den Papierkorb', exact: true }).click();
  await page.getByRole('button', { name: 'Papierkorb', exact: true }).click();
  await page.locator('.meeting-main').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
  await expect(page.locator('.meeting-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file][accept^=".zip"]').setInputFiles(archivePath);
  await expect(page.locator('.toast')).toContainText('1 wiederhergestellt');
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file][accept^=".zip"]').setInputFiles(archivePath);
  await expect(page.locator('.toast')).toContainText('0 wiederhergestellt · 1 bereits vorhanden');
  await page.locator('.setting-select select').selectOption('french');
  const fullDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vollständige Sicherung exportieren' }).click();
  const fullArchive = (await (await fullDownload).path())!;
  await page.locator('.setting-select select').selectOption('english');
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file][accept^=".zip"]').setInputFiles(fullArchive);
  await expect(page.locator('.setting-select select')).toHaveValue('french');
  await expect(page.getByRole('checkbox', { name: /Lokales Whisper erlauben/ })).not.toBeChecked();
  await page.reload();
  await expect(page.locator('.meeting-card')).toHaveCount(1);
  await page.locator('.meeting-main').click();
  await expect(page.locator('audio')).toBeVisible();
  expect(
    await page
      .locator('audio')
      .evaluate(async (el: HTMLAudioElement) => (await (await fetch(el.src)).blob()).size),
  ).toBe(wav().length);
});
test('Aufnehmen, pausieren, speichern und Original wiedergeben', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.getByRole('button', { name: 'Aufnahme starten', exact: true }).click();
  await expect(page.getByText('Aufnahme läuft', { exact: true })).toBeVisible();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Aufnahme pausiert', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('audio')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aus Audio wird Text.' })).toBeVisible();
  await page.locator('audio').evaluate((el: HTMLAudioElement) => el.play());
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('.meeting-card')).toHaveCount(1);
  await page.locator('.meeting-main').click();
  await expect(page.locator('audio')).toBeVisible();
});
test('Offline-Neustart, Suche und Export funktionieren ohne Server', async ({ page, context }) => {
  await textNote(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.meeting-card')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Gespräche durchsuchen' }).fill('3000');
  await expect(page.locator('.meeting-card')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Gespräche durchsuchen' }).fill('nichtsgefunden');
  await expect(page.locator('.meeting-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Suche leeren' }).click();
  await page.locator('.meeting-main').click();
  await page.getByRole('button', { name: 'Exportieren', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Nur Transkript (.txt)' }).click();
  const exported = await downloading;
  expect(await readFile((await exported.path())!, 'utf8')).toContain('3000 Franken');
});
test('Ungespeicherte Änderungen sind geschützt, Ordner und Einstellungen bleiben gespeichert', async ({
  page,
}) => {
  await textNote(page);
  await page.getByRole('button', { name: 'Textstelle 1 bearbeiten' }).click();
  await page.getByLabel('Gesprochener Text').fill('Nicht speichern');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.segment-body')).toContainText('3000 Franken');
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await page.locator('.setting-select select').selectOption('english');
  await page.reload();
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await expect(page.locator('.setting-select select')).toHaveValue('english');
  await expect(page.getByRole('checkbox', { name: /Lokales Whisper erlauben/ })).not.toBeChecked();
});
test('iPhone-Breiten, reduzierte Bewegung und störungsfreie Navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: 'Neue Aufnahme starten' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Audio importieren', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Schliessen', exact: true }).click();
  }
  await page.screenshot({ path: 'test-results/iphone-home.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Fehlerhafte Dateien verändern keine vorhandenen Gespräche', async ({ page }) => {
  await textNote(page);
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await page.locator('input[type=file][accept^=".zip"]').setInputFiles({
    name: 'kaputt.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('kein ZIP'),
  });
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.meeting-card')).toHaveCount(1);
  await page.locator('input[type=file][accept^="audio"]').setInputFiles({
    name: 'kaputt.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('kein Audio'),
  });
  await expect(page.locator('.toast')).toContainText('Audioformat konnte nicht gelesen werden');
  await expect(page.locator('.meeting-card')).toHaveCount(1);
});

test('Zugängliche Namen und Kontraste in Startseite, Dialog und Transkript', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect((await scan()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Audio importieren', exact: true }).click();
  expect((await scan()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Schliessen', exact: true }).click();
  await textNote(page);
  expect((await scan()).violations).toEqual([]);
});
