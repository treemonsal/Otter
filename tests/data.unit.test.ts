import { describe, it, expect } from 'vitest';
import { summary, proposedTasks, findEvidence, toSrt, clock, toMarkdown } from '../src/analysis';
import { backup, readBackup } from '../src/backup';
import type { Meeting, Segment } from '../src/types';
import { zipSync, strToU8 } from 'fflate';
const segments: Segment[] = [
  {
    id: '1',
    start: 0,
    end: 5.5,
    text: 'Das Budget für unser neues Projekt beträgt 3000 Franken.',
    speaker: 'Lea',
  },
  {
    id: '2',
    start: 5.5,
    end: 12,
    text: 'Ich werde den Zeitplan am Freitag an das Team schicken.',
    speaker: 'Timo',
  },
  {
    id: '3',
    start: 12,
    end: 20,
    text: 'Bitte prüfe das Budget vor dem nächsten Projekttermin.',
    speaker: 'Lea',
  },
];
const meeting: Meeting = {
  id: 'example',
  title: 'Projektplanung',
  createdAt: 100,
  updatedAt: 200,
  duration: 20,
  segments,
  notes: 'Nicht verlieren',
  tasks: [{ id: 't1', text: 'Prüfen', done: true }],
  folder: 'Arbeit',
  starred: true,
  revision: 3,
  audio: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }),
};
describe('belegte Textanalyse und Exporte', () => {
  it('fasst nur mit unveränderten Originalzitaten zusammen', () => {
    const result = summary(segments);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => segments.includes(s))).toBe(true);
    expect(result.map((s) => s.start)).toEqual(result.map((s) => s.start).sort((a, b) => a - b));
  });
  it('findet Aufgabenhinweise ohne den Text zu verändern', () => {
    expect(proposedTasks(segments)).toEqual([segments[1].text, segments[2].text]);
    expect(
      proposedTasks([{ ...segments[0], text: 'Wir besprechen heute das schöne Wetter.' }]),
    ).toEqual([]);
  });
  it('gibt bei fehlenden Belegen keine erfundene Antwort aus', () => {
    expect(findEvidence(segments, 'Budget')[0].id).toBe('1');
    expect(findEvidence(segments, 'Raketenstart')).toEqual([]);
    expect(findEvidence(segments, 'und die')).toEqual([]);
  });
  it('exportiert gültige Untertitel einschliesslich Rundungsgrenzen', () => {
    expect(toSrt([segments[0]])).toContain('00:00:00,000 --> 00:00:05,500');
    expect(toSrt([{ ...segments[0], start: 59.9999, end: 3600.1 }])).toContain(
      '00:01:00,000 --> 01:00:00,100',
    );
    expect(toMarkdown(meeting)).toContain('- [x] Prüfen');
    expect(toMarkdown(meeting)).toContain('Nicht verlieren');
    expect(clock(NaN)).toBe('00:00');
    expect(clock(3661)).toBe('61:01');
  });
});
describe('vollständige Sicherungen', () => {
  it('erhält Audio, Korrekturen, Notizen, Aufgaben, Ordner und Papierkorb exakt', async () => {
    const original = { ...meeting, deletedAt: 300 };
    const archive = await backup([original]);
    const {
      meetings: [restored],
    } = await readBackup(new File([archive], 'backup.zip'));
    expect({ ...restored, audio: undefined }).toEqual({ ...original, audio: undefined });
    expect(restored.audio?.type).toBe('audio/wav');
    expect(new Uint8Array(await restored.audio!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
  it('sichert die Sprache und Ordner ohne die Modellfreigabe', async () => {
    const archive = await backup([meeting], { language: 'french', folders: ['Projekt', 'Privat'] });
    const result = await readBackup(new File([archive], 'backup.zip'));
    expect(result.preferences).toEqual({ language: 'french', folders: ['Projekt', 'Privat'] });
    expect(result.preferences).not.toHaveProperty('consent');
  });
  it('weist beschädigte und fremde Archive zurück', async () => {
    await expect(readBackup(new File(['not a zip'], 'fake.zip'))).rejects.toThrow();
    await expect(
      readBackup(
        new File(
          [
            zipSync({
              'manifest.json': strToU8('{"format":"other","version":1,"meetings":[]}'),
            }) as Uint8Array<ArrayBuffer>,
          ],
          'other.zip',
        ),
      ),
    ).rejects.toThrow();
  });
  it('weist ungültige Zeitmarken zurück, bevor Daten gespeichert werden', async () => {
    const bad = { ...meeting, audio: undefined, segments: [{ ...segments[0], start: -5 }] };
    const file = new File(
      [
        zipSync({
          'manifest.json': strToU8(
            JSON.stringify({ format: 'murmur', version: 1, meetings: [bad] }),
          ),
        }) as Uint8Array<ArrayBuffer>,
      ],
      'bad.zip',
    );
    await expect(readBackup(file)).rejects.toThrow();
  });
});
