import { afterEach, expect, it, vi } from 'vitest';
import type { Segment } from '../src/types';
import { backup, readBackup } from '../src/backup';
// Protocol parsing does not open IndexedDB; provide the browser API at module initialization.
vi.mock('../src/db', () => ({ db: Promise.resolve({}), changed: () => {} }));
import { parseInsights, parseSegments, serviceUrl, runServiceJob, newJob } from '../src/ai-service';
const segments: Segment[] = [
  { id: 's1', text: 'Timo schickt das Angebot bis Freitag.', start: 0, end: 5, speaker: 'Timo' },
];
afterEach(() => vi.unstubAllGlobals());
it('verwirft fremde Belege und erfundene Personen oder Fristen', () => {
  const item = {
    text: 'Angebot senden',
    segmentId: 's1',
    quote: segments[0].text,
    assignee: 'Erfunden',
    dueText: '2027-01-01',
  };
  const result = parseInsights(
    {
      model: 'Testmodell',
      highlights: [],
      decisions: [],
      questions: [],
      tasks: [
        item,
        { ...item, segmentId: 'missing' },
        { ...item, quote: 'Nicht im Gespräch gesagt.' },
      ],
    },
    segments,
    2,
  );
  expect(result.tasks).toHaveLength(1);
  expect(result.tasks[0].assignee).toBe('');
  expect(result.tasks[0].dueText).toBe('');
  expect(result.rejected).toBe(2);
  expect(result.revision).toBe(2);
});
it('akzeptiert echte Zeitmarken und markierte Unsicherheit, lehnt ungültige Werte ab', () => {
  expect(parseSegments([{ ...segments[0], speakerUncertain: true }], 5)[0].speakerUncertain).toBe(
    true,
  );
  for (const value of [
    [{ ...segments[0], start: -1 }],
    [{ ...segments[0], end: NaN }],
    [{ ...segments[0], end: 99 }],
    [segments[0], segments[0]],
  ])
    expect(() => parseSegments(value, 5)).toThrow();
});
it('verhindert Credentials und unverschlüsselte externe Serveradressen', () => {
  vi.stubGlobal('location', { hostname: 'treemonsal.github.io' });
  for (const url of [
    'http://example.org',
    'https://user:secret@example.org',
    'https://example.org/?key=secret',
    'https://example.org/#secret',
  ])
    expect(() => serviceUrl(url)).toThrow();
  expect(serviceUrl('https://example.org/')).toBe('https://example.org');
  vi.stubGlobal('location', { hostname: '127.0.0.1' });
  expect(serviceUrl('http://127.0.0.1:7860')).toBe('http://127.0.0.1:7860');
});
it('behält Auswertung, verantwortliche Person, Frist, Live-Text und Markierungen im Backup', async () => {
  const { newMeeting } = await import('../src/types');
  const item = {
    id: 'i1',
    text: 'Angebot senden',
    segmentId: 's1',
    quote: segments[0].text,
    assignee: 'Timo',
    dueText: 'Freitag',
  };
  const original = {
    ...newMeeting('Projekt'),
    duration: 5,
    segments,
    transcriptionSource: 'murmur-ai' as const,
    liveSegments: segments,
    bookmarks: [{ id: 'b', start: 2, label: 'Wichtig' }],
    tasks: [
      {
        id: 't',
        text: item.text,
        done: false,
        assignee: 'Timo',
        dueText: 'Freitag',
        dueDate: '2026-10-23',
        segmentId: 's1',
        quote: item.quote,
        sourceRevision: 0,
      },
    ],
    insights: {
      revision: 0,
      createdAt: 1,
      model: 'Test',
      rejected: 0,
      highlights: [],
      decisions: [],
      questions: [],
      tasks: [item],
    },
  };
  const archive = await backup([original]);
  const result = await readBackup(new File([archive], 'data.zip'));
  expect(result.meetings[0]).toEqual({ ...original, audio: undefined });
  const invalid = await backup([
    { ...original, tasks: [{ ...original.tasks[0], dueDate: '2026-02-31' }] },
  ]);
  await expect(readBackup(new File([invalid], 'invalid.zip'))).rejects.toThrow();
});
it('setzt einen Upload fort, ohne bereits bestätigte Abschnitte erneut zu senden', async () => {
  vi.stubGlobal('location', { hostname: '127.0.0.1' });
  const { newMeeting, defaultSettings } = await import('../src/types');
  const meeting = {
    ...newMeeting('Test'),
    audio: new Blob([new Uint8Array(2 * 1024 * 1024 + 3)]),
    duration: 5,
    segments,
  };
  const job = {
    ...newJob(meeting, 'transcription', { ...defaultSettings, serviceUrl: 'https://ai.example' }),
    remoteId: 'a'.repeat(43),
  };
  const requests: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method || 'GET' });
      const data = url.endsWith('/audio/1')
        ? { received: 3 }
        : url.endsWith('/start')
          ? {
              id: job.remoteId,
              status: 'complete',
              completedSeconds: 5,
              segments,
              prototypes: [],
              duration: 5,
            }
          : { id: job.remoteId, status: 'uploading', uploaded: [0] };
      return Response.json(data);
    }),
  );
  const result = await runServiceJob(job, meeting, new AbortController().signal, async () => {});
  expect(requests.filter((r) => r.method === 'PUT').map((r) => r.url)).toEqual([
    `https://ai.example/v1/jobs/${job.remoteId}/audio/1`,
  ]);
  expect(result.status).toBe('complete');
  expect(result.segments[0].text).toBe(segments[0].text);
});
it('setzt nach verlorenen Serverdaten mit gespeichertem Text, Stimme und Position fort', async () => {
  vi.stubGlobal('location', { hostname: '127.0.0.1' });
  const { newMeeting, defaultSettings } = await import('../src/types');
  const meeting = { ...newMeeting('Test'), audio: new Blob(['audio']), duration: 90, segments };
  const job = {
    ...newJob(meeting, 'transcription', { ...defaultSettings, serviceUrl: 'https://ai.example' }),
    remoteId: 'a'.repeat(43),
    completedSeconds: 60,
    segments,
    prototypes: [Array(512).fill(0.1)],
  };
  const payloads: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('a'.repeat(43))) return new Response('', { status: 404 });
      if (url.endsWith('/v1/jobs')) {
        payloads.push(JSON.parse(init.body as string));
        return Response.json({ id: 'b'.repeat(43), status: 'uploading', uploaded: [] });
      }
      if (url.endsWith('/start'))
        return Response.json({
          status: 'complete',
          completedSeconds: 90,
          duration: 90,
          segments: [{ ...segments[0], id: 's2', start: 60, end: 65 }],
          prototypes: job.prototypes,
        });
      return Response.json({ received: 5 });
    }),
  );
  const result = await runServiceJob(job, meeting, new AbortController().signal, async () => {});
  expect(payloads[0].startAt).toBe(60);
  expect(payloads[0].prototypes).toHaveLength(1);
  expect(result.segments.map((s) => s.id)).toEqual(['s1', 's2']);
});
