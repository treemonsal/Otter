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
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
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
  await expect
    .poll(async () =>
      Number(
        await page.getByRole('meter', { name: 'Mikrofonpegel' }).getAttribute('aria-valuenow'),
      ),
    )
    .toBeGreaterThan(0);
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
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
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
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
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

test('Verlauf, Neuladen und Tastatur-Navigation erhalten die Gesprächsansicht', async ({
  page,
}) => {
  await textNote(page);
  const url = page.url();
  await page.getByRole('tab', { name: 'Transkript', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Überblick' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Überblick' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Überblick' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Deine Gespräche.' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('tab', { name: 'Überblick' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(page.url()).not.toBe(url);
  await page.getByRole('tab', { name: 'Notizen', exact: true }).click();
  await page.getByRole('button', { name: 'Notiz schreiben' }).click();
  await page.getByRole('textbox', { name: 'Notizen', exact: true }).fill('Noch nicht gespeichert');
  page.once('dialog', (d) => d.dismiss());
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Notizen', exact: true })).toHaveValue(
    'Noch nicht gespeichert',
  );
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Deine Gespräche.' })).toBeVisible();
});

test('Ordner umbenennen und entfernen erhält alle Gespräche', async ({ page }) => {
  await textNote(page);
  await page.getByLabel('Gesprächsordner').selectOption('Arbeit');
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await page.getByRole('button', { name: 'Ordner Arbeit umbenennen' }).click();
  await page.getByLabel('Ordnername').fill('Projekt Zürich');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await page.locator('.meeting-main').click();
  await expect(page.getByLabel('Gesprächsordner')).toHaveValue('Projekt Zürich');
  await expect(page.locator('.segment-body')).toContainText('3000 Franken');
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Ordner Projekt Zürich entfernen' }).click();
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await expect(page.locator('.meeting-card')).toHaveCount(1);
  await page.locator('.meeting-main').click();
  await expect(page.getByLabel('Gesprächsordner')).toHaveValue('');
  await expect(page.locator('.segment-body')).toContainText('3000 Franken');
});

test('Parallele Fenster überschreiben keine offenen Notizen', async ({ page, context }) => {
  await textNote(page);
  await page.getByRole('tab', { name: 'Notizen', exact: true }).click();
  const other = await context.newPage();
  await other.goto(page.url());
  await page.getByRole('button', { name: 'Notiz schreiben' }).click();
  await page
    .getByRole('textbox', { name: 'Notizen', exact: true })
    .fill('Mein noch offener Entwurf');
  await other.getByRole('button', { name: 'Notiz schreiben' }).click();
  await other
    .getByRole('textbox', { name: 'Notizen', exact: true })
    .fill('Im zweiten Fenster gespeichert');
  await other.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(other.locator('.notes-text')).toHaveText('Im zweiten Fenster gespeichert');
  await page.bringToFront();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'anderen Fenster geändert',
  );
  await expect(page.getByRole('textbox', { name: 'Notizen', exact: true })).toHaveValue(
    'Mein noch offener Entwurf',
  );
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.locator('.notes-text')).toHaveText('Im zweiten Fenster gespeichert');
  await other.close();
});

test('Passwortgeschützte Sicherung ist auf einem neuen Gerät wiederherstellbar', async ({
  page,
  browser,
}) => {
  await textNote(page);
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await page.getByRole('button', { name: 'Passwortgeschützte Sicherung', exact: true }).click();
  await page.getByLabel('Passwort', { exact: true }).fill('Sicheres Testpasswort 2026');
  await page.getByLabel('Passwort wiederholen').fill('Sicheres Testpasswort 2026');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Verschlüsselt exportieren' }).click();
  const file = await downloading;
  const path = (await file.path())!;
  expect(file.suggestedFilename()).toMatch(/\.murmur$/);
  const fresh = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const device = await fresh.newPage();
    await device.goto('http://127.0.0.1:4173/Otter/');
    await device.locator('input[type=file][accept^=".zip"]').setInputFiles(path);
    await device.getByLabel('Passwort', { exact: true }).fill('Falsches Passwort');
    await device.getByRole('button', { name: 'Entsperren', exact: true }).click();
    await expect(device.getByRole('alert')).toContainText('Passwort falsch');
    await device.getByLabel('Passwort', { exact: true }).fill('Sicheres Testpasswort 2026');
    device.once('dialog', (d) => d.accept());
    await device.getByRole('button', { name: 'Entsperren', exact: true }).click();
    await expect(device.locator('.meeting-card')).toHaveCount(1);
    await device.locator('.meeting-main').click();
    await expect(device.locator('.segment-body')).toContainText('3000 Franken');
    await device.getByRole('button', { name: 'Einstellungen öffnen' }).click();
    await expect(
      device.getByRole('checkbox', { name: /Lokales Whisper erlauben/ }),
    ).not.toBeChecked();
  } finally {
    await fresh.close();
  }
});

test('Versionsprüfung schützt auch ohne rechtzeitige Fenstermeldung', async ({ page, context }) => {
  await textNote(page);
  await page.getByRole('tab', { name: 'Notizen', exact: true }).click();
  await page.evaluate(() =>
    document.addEventListener(
      'visibilitychange',
      (event) => event.stopImmediatePropagation(),
      true,
    ),
  );
  const other = await context.newPage();
  // Simulate a background browser that does not deliver BroadcastChannel notifications.
  await other.addInitScript(() => {
    (window as any).BroadcastChannel = class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
    };
  });
  await other.goto(page.url());
  await page.getByRole('button', { name: 'Notiz schreiben' }).click();
  await page.getByRole('textbox', { name: 'Notizen', exact: true }).fill('Offener Entwurf');
  await other.getByRole('button', { name: 'Notiz schreiben' }).click();
  await other
    .getByRole('textbox', { name: 'Notizen', exact: true })
    .fill('Neueste gespeicherte Fassung');
  await other.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(other.locator('.notes-text')).toHaveText('Neueste gespeicherte Fassung');
  await page.bringToFront();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'anderen Fenster geändert',
  );
  await expect(page.getByRole('textbox', { name: 'Notizen', exact: true })).toHaveValue(
    'Offener Entwurf',
  );
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.locator('.notes-text')).toHaveText('Neueste gespeicherte Fassung');
  await other.close();
});

test('Speicherfehler rollen sichtbare Änderungen zurück und zeigen keinen Erfolg', async ({
  page,
}) => {
  await textNote(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'meetings') {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Test: full disk', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Favorit umschalten' }).click();
  await expect(page.getByRole('alert')).toContainText('Speichern fehlgeschlagen');
  await expect(page.getByRole('button', { name: 'Favorit umschalten' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Favorit umschalten' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('.segment-body')).toContainText('3000 Franken');
});

const cloudHost = 'https://hf-audio-whisper-large-v3.hf.space';
async function cloudAudio(page: Page) {
  await page
    .locator('input[type=file][accept^="audio"]')
    .setInputFiles({ name: 'Vertraulicher Titel.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.locator('audio')).toBeVisible();
}
async function sendCloud(page: Page) {
  await page.getByRole('button', { name: 'Online transkribieren', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Hugging Face');
  await page.getByRole('button', { name: 'Audio senden & starten' }).click();
}

test('Online sendet erst nach Start nur das gewählte Audio und erhält das Original im Backup', async ({
  page,
}) => {
  const requests: { path: string; body: string }[] = [];
  await page.route(`${cloudHost}/**`, async (route) => {
    const request = route.request();
    requests.push({ path: new URL(request.url()).pathname, body: request.postData() || '' });
    const path = new URL(request.url()).pathname;
    await route.fulfill({
      status: 200,
      contentType: path.endsWith('test-event') ? 'text/event-stream' : 'application/json',
      body: path.endsWith('/upload')
        ? '["/tmp/gradio/audio.wav"]'
        : path.endsWith('/transcribe')
          ? '{"event_id":"test-event"}'
          : 'event: complete\ndata: ["Das Online-Modell erkennt unser Gespräch."]\n\n',
    });
  });
  await cloudAudio(page);
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect((await scan()).violations).toEqual([]);
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Online transkribieren', exact: true }).click();
  expect((await scan()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Zurück', exact: true }).last().click();
  expect(requests).toHaveLength(0);
  await sendCloud(page);
  await expect(page.locator('.segment-body p')).toHaveText(
    'Das Online-Modell erkennt unser Gespräch.',
  );
  expect(requests.map((r) => r.path)).toEqual([
    '/gradio_api/upload',
    '/gradio_api/call/transcribe',
    '/gradio_api/call/transcribe/test-event',
  ]);
  expect(requests[0].body).toContain('filename="audio.wav"');
  expect(requests.map((r) => r.body).join('')).not.toContain('Vertraulicher');
  await expect(page.locator('.transcription-source')).toContainText('online verarbeitet');
  await page.reload();
  await expect(page.locator('.transcription-source')).toContainText('Whisper large v3');
  await page.getByRole('button', { name: 'Exportieren', exact: true }).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Komplettes Gespräch (.zip)', exact: true }).click();
  const zip = unzipSync(await readFile((await (await exported).path())!));
  const m = JSON.parse(strFromU8(zip['manifest.json'])).meetings[0];
  expect(m.transcriptionSource).toBe('cloud-whisper-large-v3');
  expect(Buffer.from(zip[`audio/${m.id}`])).toEqual(wav());
  const fresh = await page.context().browser()!.newContext();
  try {
    const other = await fresh.newPage();
    await other.goto('http://127.0.0.1:4173/Otter/');
    await other.getByRole('button', { name: 'Einstellungen öffnen' }).click();
    other.once('dialog', (d) => d.accept());
    await other
      .locator('input[type=file][accept^=".zip"]')
      .setInputFiles((await (await exported).path())!);
    await expect(other.locator('.toast')).toContainText('1 wiederhergestellt');
    await other.getByRole('button', { name: 'Übersicht', exact: true }).click();
    await other.locator('.meeting-main').click();
    await expect(other.locator('.segment-body p')).toHaveText(
      'Das Online-Modell erkennt unser Gespräch.',
    );
    await expect(other.locator('.transcription-source')).toContainText('Whisper large v3');
  } finally {
    await fresh.close();
  }
});

test('Online-Ausfall, Offline-Modus und Aufnahmelimit lassen lokale Erkennung verfügbar', async ({
  page,
  context,
}) => {
  await page.route(`${cloudHost}/**`, (route) => route.fulfill({ status: 429, body: 'Limit' }));
  await cloudAudio(page);
  await sendCloud(page);
  await expect(page.locator('.error-box')).toContainText('Nutzungslimit');
  await expect(page.locator('audio')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Transkription starten', exact: true }),
  ).toBeEnabled();
  await context.setOffline(true);
  await expect(
    page.getByRole('button', { name: 'Online transkribieren', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Transkription starten', exact: true }),
  ).toBeEnabled();
  await context.setOffline(false);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('murmur-private');
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('meetings', 'readwrite');
    const records = tx.objectStore('meetings').getAll();
    records.onsuccess = () =>
      tx.objectStore('meetings').put({ ...records.result[0], duration: 301 });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Online transkribieren', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.cloud-option')).toContainText('länger als 5 Minuten');
  await expect(
    page.getByRole('button', { name: 'Transkription starten', exact: true }),
  ).toBeEnabled();
});

test('Späte Online-Antworten überschreiben weder Korrekturen noch abgebrochene Ergebnisse', async ({
  page,
}) => {
  let release: () => void = () => {};
  let requested = false;
  await page.route(`${cloudHost}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/upload')) {
      await route.fulfill({ json: ['/tmp/gradio/audio.wav'] });
      return;
    }
    if (path.endsWith('/transcribe')) {
      await route.fulfill({ json: { event_id: 'delayed-event' } });
      return;
    }
    requested = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({
        contentType: 'text/event-stream',
        body: 'event: complete\ndata: ["Neues Online-Ergebnis"]\n\n',
      })
      .catch(() => {});
  });
  await cloudAudio(page);
  await sendCloud(page);
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Text ergänzen', exact: true }).click();
  await page.getByLabel('Gesprochener Text').fill('Meine Korrektur bleibt.');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  release();
  await expect(
    page.getByRole('dialog', { name: 'Deine Korrekturen bleiben erhalten.' }),
  ).toBeVisible();
  await expect(page.locator('.segment-body p')).toHaveText('Meine Korrektur bleibt.');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Neues Ergebnis exportieren' }).click();
  expect(await readFile((await (await downloadEvent).path())!, 'utf8')).toContain(
    'Neues Online-Ergebnis',
  );
  requested = false;
  page.once('dialog', (d) => d.accept());
  await sendCloud(page);
  await expect.poll(() => requested).toBe(true);
  await page
    .locator('.processing-banner')
    .getByRole('button', { name: 'Abbrechen', exact: true })
    .click();
  release();
  await expect(page.locator('.processing-banner')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.segment-body p')).toHaveText('Meine Korrektur bleibt.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
