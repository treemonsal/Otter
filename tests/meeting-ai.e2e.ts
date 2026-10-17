import { test, expect, type Page, type Route } from '@playwright/test';
const endpoint = 'https://murmur-ai.test';
const token = 'a'.repeat(43);
const health = {
  service: 'murmur-ai',
  version: 1,
  capabilities: ['transcription', 'speakers', 'insights'],
  maxSeconds: 3600,
  retentionHours: 24,
  models: { speech: 'Kontrollierter Testdienst', speakers: 'Test', insights: 'Test' },
};
function wav(seconds = 2) {
  const samples = seconds * 16000;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  return data;
}
const reply = (route: Route, data: unknown) => route.fulfill({ json: data });
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Einstellungen öffnen' }).click();
  await page.getByLabel('KI-Serveradresse').fill(endpoint);
  await page.getByRole('button', { name: 'Prüfen & verbinden' }).click();
  await expect(page.getByLabel('KI-Serveradresse')).toHaveValue(endpoint);
  await expect(page.getByText(/Verbunden: Kontrollierter Testdienst/)).toBeVisible();
}
async function audio(page: Page, seconds = 2) {
  await page
    .locator('input[type=file][accept^="audio"]')
    .setInputFiles({ name: 'Meeting.wav', mimeType: 'audio/wav', buffer: wav(seconds) });
  await expect(page.locator('audio')).toBeVisible();
}
async function start(page: Page) {
  await page.getByRole('button', { name: 'Transkription starten', exact: true }).click();
  await page.getByRole('button', { name: 'Mit Meeting-KI verarbeiten', exact: true }).click();
  await page.getByRole('button', { name: 'Audio senden & verarbeiten', exact: true }).click();
}
async function text(page: Page) {
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  await page.getByRole('button', { name: 'Audio importieren', exact: true }).click();
  await page.getByRole('button', { name: 'Mit Text beginnen' }).click();
  await page.getByLabel('Gesprochener Text').fill('Timo schickt das Angebot bis Freitag.');
  await page.getByLabel('Sprecher oder Sprecherin').fill('Timo');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Deine Gespräche.' })).toBeVisible();
});

test('Unterbrochenen Audio-Upload nach Neuladen ohne doppelte Abschnitte fortsetzen', async ({
  page,
}) => {
  const counts = [0, 0];
  let status = 'uploading';
  let polls = 0;
  const segments = [
    {
      id: 's1',
      start: 0,
      end: 60,
      text: 'Erster gespeicherter Abschnitt.',
      speaker: 'Sprecher 1',
      speakerUncertain: false,
    },
    {
      id: 's2',
      start: 60,
      end: 67,
      text: 'Zweiter Abschnitt mit anderer Stimme.',
      speaker: 'Sprecher 2',
      speakerUncertain: true,
    },
  ];
  await page.context().route(`${endpoint}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/health') return reply(route, health);
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    if (path === '/v1/jobs') return reply(route, { id: token, status, uploaded: [] });
    if (path.includes('/audio/')) {
      const index = Number(path.split('/').at(-1));
      counts[index]++;
      if (index === 1 && counts[1] === 1)
        return route.fulfill({ status: 503, body: 'Simulierter Verbindungsabbruch' });
      return reply(route, { received: 1 });
    }
    if (path.endsWith('/start')) {
      status = 'processing';
      return reply(route, {
        id: token,
        status,
        completedSeconds: 60,
        duration: 67,
        segments: segments.slice(0, 1),
        prototypes: [Array(512).fill(0.1)],
        message: 'Abschnitt 1 gespeichert',
      });
    }
    if (status === 'uploading') return reply(route, { id: token, status, uploaded: [0] });
    polls++;
    return reply(route, {
      id: token,
      status: 'complete',
      completedSeconds: 67,
      duration: 67,
      segments,
      prototypes: [Array(512).fill(0.1)],
      message: 'Fertig',
    });
  });
  await connect(page);
  await audio(page, 67);
  await start(page);
  await expect(page.locator('.ai-job')).toContainText('Zwischenstand gespeichert');
  await expect(page.locator('.error-box')).toContainText('Anfrage nicht verarbeiten');
  await page.reload();
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect(page.locator('.segment-body p')).toHaveCount(2);
  expect(counts).toEqual([1, 2]);
  expect(polls).toBe(1);
  await expect(page.getByText('Zuordnung prüfen', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sprecher 1 umbenennen', exact: true }).click();
  await page.getByLabel('Neuer Sprechername').fill('Lea');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.segment-body strong').first()).toHaveText('Lea');
  await page.reload();
  await expect(page.locator('.segment-body p')).toHaveCount(2);
  await expect(page.locator('.ai-job')).toHaveCount(0);
});

test('Belegte KI-Aufgaben prüfen, Verantwortliche und Datum bestätigen, veraltete Auswertung kennzeichnen', async ({
  page,
}) => {
  let sources: any[] = [];
  let payload = '';
  await page.context().route(`${endpoint}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/health') return reply(route, health);
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    if (path === '/v1/jobs') {
      payload = route.request().postData()!;
      sources = JSON.parse(payload).segments;
      return reply(route, {
        id: token,
        status: 'complete',
        insights: {
          model: 'Kontrollierter Testdienst',
          rejected: 0,
          highlights: [
            {
              text: 'Das Angebot wird versendet.',
              segmentId: sources[0].id,
              quote: sources[0].text,
            },
          ],
          decisions: [],
          questions: [],
          tasks: [
            {
              text: 'Angebot schicken',
              segmentId: sources[0].id,
              quote: sources[0].text,
              assignee: 'Timo',
              dueText: 'Freitag',
            },
          ],
        },
      });
    }
    throw new Error(path);
  });
  await connect(page);
  await text(page);
  await page.getByRole('tab', { name: 'Notizen', exact: true }).click();
  await page.getByRole('button', { name: 'Notiz schreiben' }).click();
  await page
    .getByRole('textbox', { name: 'Notizen', exact: true })
    .fill('Diese private Notiz wird nicht übertragen.');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('tab', { name: 'Überblick' }).click();
  await page.getByRole('button', { name: 'Mit KI auswerten', exact: true }).click();
  await page.getByRole('button', { name: 'Transkript senden & auswerten' }).click();
  await expect(page.locator('.insight-item')).toContainText('Das Angebot wird versendet.');
  expect(payload).not.toContain('private Notiz');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect((await scan()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Aufgabenvorschläge prüfen (1)', exact: true }).click();
  expect((await scan()).violations).toEqual([]);
  await expect(page.getByLabel('Verantwortlich', { exact: true })).toHaveValue('Timo');
  await expect(page.getByLabel('Termin laut Gespräch', { exact: true })).toHaveValue('Freitag');
  await page.getByLabel('Datum (optional bestätigen)').fill('2026-10-23');
  await page.getByRole('button', { name: 'Ausgewählte Aufgaben übernehmen' }).click();
  await page.getByRole('tab', { name: 'Aufgaben' }).click();
  await expect(page.locator('.task-row')).toContainText('Timo · 2026-10-23');
  await page.locator('.task-row').getByRole('button', { name: 'Beleg', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Transkript' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Textstelle 1 bearbeiten' }).click();
  await page.getByLabel('Gesprochener Text').fill('Timo schickt das Angebot am Montag.');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('tab', { name: 'Überblick' }).click();
  await expect(page.locator('.ai-insights')).toContainText('veraltet');
  await expect(page.getByRole('button', { name: 'Beleg im Transkript' })).toBeDisabled();
  await page.reload();
  await expect(page.locator('.ai-insights')).toContainText('veraltet');
});

test('Live-Mitschrift und Zeitmarkierungen bleiben nach Pause, Speichern und Neustart erhalten', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    class Recognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: any = null;
      onend: any = null;
      onerror: any = null;
      start() {
        (window as any).__testRecognition = this;
      }
      stop() {}
      abort() {}
    }
    (window as any).SpeechRecognition = Recognition;
  });
  await page.reload();
  await context.grantPermissions(['microphone']);
  await page.getByRole('button', { name: 'Aufnahme starten', exact: true }).click();
  await expect(page.getByText('Aufnahme läuft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Live-Text starten', exact: true }).click();
  await page.evaluate(() => {
    const recognition = (window as any).__testRecognition;
    recognition.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'Vorläufige Mitschrift aus dem Test.' } }],
    });
  });
  await expect(page.getByLabel('Vorläufige Live-Mitschrift')).toContainText(
    'Vorläufige Mitschrift',
  );
  await page.getByRole('button', { name: 'Stelle markieren', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Live-Text stoppen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Live-Text übernehmen', exact: true }).click();
  await expect(page.locator('.segment-body p')).toHaveText('Vorläufige Mitschrift aus dem Test.');
  await expect(page.locator('.bookmarks')).toContainText('Markierung 1');
  await expect(page.locator('.transcription-source')).toContainText('ungefähre Zeitmarken');
});

test('Aktiver KI-Auftrag wird durch ein zweites Fenster nicht doppelt gestartet', async ({
  page,
  context,
}) => {
  let creates = 0;
  await context.route(`${endpoint}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/health') return reply(route, health);
    if (path === '/v1/jobs') {
      creates++;
      return reply(route, { id: token, status: 'uploading', uploaded: [] });
    }
    if (path.includes('/audio/')) return reply(route, { received: 1 });
    return reply(route, {
      id: token,
      status: path.endsWith('/pause') ? 'paused' : 'processing',
      completedSeconds: 0,
      duration: 2,
      segments: [],
      prototypes: [],
      message: 'Kontrollierter laufender Auftrag',
    });
  });
  await connect(page);
  await audio(page);
  await start(page);
  await expect(page.locator('.processing-banner')).toContainText(
    'Kontrollierter laufender Auftrag',
  );
  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect(second.locator('.error-box')).toContainText('anderen Fenster');
  expect(creates).toBe(1);
  await page.locator('.processing-banner').getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.locator('.processing-banner')).toHaveCount(0);
  await second.close();
});

test('Bestehende Datenbankversion wird ohne Datenverlust um den Auftragsspeicher erweitert', async ({
  page,
}) => {
  // Separate origin profile with a genuine old version before loading any app code.
  const fresh = await page.context().browser()!.newContext();
  try {
    const old = await fresh.newPage();
    await old.route('http://127.0.0.1:4173/legacy-seed', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Legacy database fixture</title>',
      }),
    );
    await old.goto('http://127.0.0.1:4173/legacy-seed');
    await old.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('murmur-private', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('meetings', { keyPath: 'id' });
          request.result.createObjectStore('settings');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('meetings', 'readwrite');
      tx.objectStore('meetings').put({
        id: 'legacy',
        title: 'Alte Aufnahme',
        createdAt: 1,
        updatedAt: 1,
        duration: 1,
        segments: [{ id: 's', text: 'Vorhandene Korrektur', start: 0, end: 1, speaker: 'Lea' }],
        notes: 'Nicht verlieren',
        tasks: [],
        folder: '',
        starred: false,
        revision: 1,
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    });
    await old.goto('http://127.0.0.1:4173/Otter/');
    await old.getByText('Alte Aufnahme', { exact: true }).click();
    await expect(old.locator('.segment-body p')).toHaveText('Vorhandene Korrektur');
    const state = await old.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('murmur-private');
        request.onsuccess = () => resolve(request.result);
      });
      const result = { version: db.version, jobs: db.objectStoreNames.contains('jobs') };
      db.close();
      return result;
    });
    expect(state).toEqual({ version: 2, jobs: true });
  } finally {
    await fresh.close();
  }
});

test('Lange Audiodatei importiert nur Metadaten und decodiert nicht auf dem Handy', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error('Import darf kein PCM decodieren');
      }
    } as unknown as typeof AudioContext;
  });
  await audio(page, 67);
  await expect(page.getByRole('heading', { name: 'Meeting', exact: true })).toBeVisible();
  await expect(page.locator('.audio-label strong')).toContainText('01:07');
});

test('Endgültiges Löschen entfernt auch pausierte KI-Aufträge und ihre lokalen Token', async ({
  page,
}) => {
  let deleted = false;
  await page.context().route(`${endpoint}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/health') return reply(route, health);
    if (route.request().method() === 'DELETE') {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (path === '/v1/jobs') return reply(route, { id: token, status: 'uploading', uploaded: [] });
    return route.fulfill({ status: 503, body: 'Controlled interruption' });
  });
  await connect(page);
  await audio(page);
  await start(page);
  await expect(page.locator('.error-box')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'In den Papierkorb', exact: true }).click();
  await page.getByRole('button', { name: 'Papierkorb', exact: true }).click();
  await page.locator('.meeting-main').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
  await expect(page.locator('.meeting-card')).toHaveCount(0);
  await expect.poll(() => deleted).toBe(true);
  const jobs = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('murmur-private');
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('jobs');
    const rows = await new Promise<any[]>((resolve) => {
      const request = tx.objectStore('jobs').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return rows.length;
  });
  expect(jobs).toBe(0);
});
