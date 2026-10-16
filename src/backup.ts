import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Meeting, Settings } from './types';
const MAX = 512 * 1024 * 1024;
export async function backup(
  meetings: Meeting[],
  preferences?: Pick<Settings, 'language' | 'folders'>,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const records = [];
  let total = 0;
  for (const m of meetings) {
    const { audio, ...record } = m;
    total += audio?.size || 0;
    if (total > MAX)
      throw new Error(
        'Diese Sicherung ist zu gross für den Arbeitsspeicher. Exportiere Audio zusätzlich einzeln.',
      );
    const audioPath = audio ? `audio/${m.id}` : null;
    if (audio && audioPath) files[audioPath] = new Uint8Array(await audio.arrayBuffer());
    records.push({ ...record, audioPath, audioType: audio?.type });
  }
  files['manifest.json'] = strToU8(
    JSON.stringify({
      format: 'murmur',
      version: 1,
      exportedAt: new Date().toISOString(),
      meetings: records,
      ...(preferences
        ? { preferences: { language: preferences.language, folders: preferences.folders } }
        : {}),
    }),
  );
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], {
    type: 'application/zip',
  });
}
function assert(
  condition: unknown,
  message = 'Die Sicherung ist beschädigt oder hat ein unbekanntes Format.',
): asserts condition {
  if (!condition) throw new Error(message);
}
const safeText = (x: unknown, max = 1000000): x is string =>
  typeof x === 'string' && x.length <= max;
const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
export async function readBackup(
  file: File,
): Promise<{ meetings: Meeting[]; preferences?: Pick<Settings, 'language' | 'folders'> }> {
  assert(file.size < MAX, 'Die Sicherung darf höchstens 512 MB gross sein.');
  let size = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => {
      size += f.originalSize;
      assert(size <= MAX, 'Die entpackte Sicherung ist zu gross.');
      return true;
    },
  });
  assert(files['manifest.json'] && files['manifest.json'].length < 20 * 1024 * 1024);
  const data = JSON.parse(strFromU8(files['manifest.json']));
  assert(
    data.format === 'murmur' &&
      data.version === 1 &&
      Array.isArray(data.meetings) &&
      data.meetings.length <= 10000,
  );
  if (data.preferences !== undefined) {
    const p = data.preferences;
    assert(p && ['german', 'english', 'french', 'italian', 'auto'].includes(p.language));
    assert(
      Array.isArray(p.folders) &&
        p.folders.length <= 1000 &&
        p.folders.every((f: unknown) => safeText(f, 100) && f.trim()),
    );
  }
  const ids = new Set<string>();
  const meetings = data.meetings.map((m: Record<string, any>) => {
    assert(safeText(m.id, 100) && /^[\w-]+$/.test(m.id) && !ids.has(m.id));
    ids.add(m.id);
    assert(safeText(m.title, 300) && safeText(m.notes) && safeText(m.folder, 100));
    assert(
      time(m.createdAt) &&
        time(m.updatedAt) &&
        time(m.duration) &&
        Number.isInteger(m.revision) &&
        m.revision >= 0,
    );
    assert(typeof m.starred === 'boolean' && (m.deletedAt === undefined || time(m.deletedAt)));
    assert(
      Array.isArray(m.segments) &&
        m.segments.length <= 50000 &&
        Array.isArray(m.tasks) &&
        m.tasks.length <= 10000,
    );
    assert(
      m.segments.every(
        (s: any) =>
          safeText(s.id, 100) &&
          safeText(s.text) &&
          safeText(s.speaker, 100) &&
          time(s.start) &&
          time(s.end) &&
          s.end >= s.start,
      ),
    );
    assert(
      m.tasks.every(
        (t: any) => safeText(t.id, 100) && safeText(t.text, 10000) && typeof t.done === 'boolean',
      ),
    );
    if (m.audioPath)
      assert(m.audioPath === `audio/${m.id}` && files[m.audioPath] && safeText(m.audioType, 150));
    const { audioPath, audioType, ...record } = m;
    return {
      ...record,
      audio: audioPath
        ? new Blob([files[audioPath] as Uint8Array<ArrayBuffer>], { type: audioType })
        : undefined,
    } as Meeting;
  });
  return { meetings, preferences: data.preferences };
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}\s_-]/gu, '').slice(0, 80) || 'Gespraech';
}
