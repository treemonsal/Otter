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
  const archive = zipSync(files, { level: 0 });
  if (archive.length >= MAX)
    throw new Error('Die Sicherung überschreitet die sichere Dateigrösse von 512 MB.');
  return new Blob([archive as Uint8Array<ArrayBuffer>], {
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
async function parseBackup(
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
      m.transcriptionSource === undefined ||
        ['local-whisper-tiny', 'cloud-whisper-large-v3', 'murmur-ai', 'browser-live'].includes(
          m.transcriptionSource,
        ),
    );
    assert(
      Array.isArray(m.segments) &&
        m.segments.length <= 50000 &&
        Array.isArray(m.tasks) &&
        m.tasks.length <= 10000,
    );
    assert(new Set(m.segments.map((s: any) => s.id)).size === m.segments.length);
    assert(new Set(m.tasks.map((t: any) => t.id)).size === m.tasks.length);
    assert(
      m.segments.every(
        (s: any) =>
          safeText(s.id, 100) &&
          safeText(s.text) &&
          safeText(s.speaker, 100) &&
          time(s.start) &&
          time(s.end) &&
          s.end >= s.start &&
          (s.speakerUncertain === undefined || typeof s.speakerUncertain === 'boolean'),
      ),
    );
    assert(
      m.tasks.every(
        (t: any) => safeText(t.id, 100) && safeText(t.text, 10000) && typeof t.done === 'boolean',
      ),
    );
    for (const task of m.tasks) {
      assert(task.assignee === undefined || safeText(task.assignee, 120));
      assert(task.dueText === undefined || safeText(task.dueText, 120));
      assert(
        task.dueDate === undefined ||
          task.dueDate === '' ||
          (safeText(task.dueDate, 10) &&
            /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) &&
            Number.isFinite(Date.parse(task.dueDate)) &&
            new Date(task.dueDate).toISOString().slice(0, 10) === task.dueDate),
      );
      assert(task.segmentId === undefined || safeText(task.segmentId, 100));
      assert(task.quote === undefined || safeText(task.quote, 100000));
      assert(
        task.sourceRevision === undefined ||
          (Number.isInteger(task.sourceRevision) && task.sourceRevision >= 0),
      );
    }
    if (m.liveSegments !== undefined) {
      assert(
        Array.isArray(m.liveSegments) &&
          m.liveSegments.length <= 50000 &&
          new Set(m.liveSegments.map((s: any) => s.id)).size === m.liveSegments.length,
      );
      assert(
        m.liveSegments.every(
          (s: any) =>
            safeText(s.id, 100) &&
            safeText(s.text) &&
            safeText(s.speaker, 100) &&
            time(s.start) &&
            time(s.end) &&
            s.end >= s.start &&
            (s.speakerUncertain === undefined || typeof s.speakerUncertain === 'boolean'),
        ),
      );
    }
    if (m.bookmarks !== undefined) {
      assert(
        Array.isArray(m.bookmarks) &&
          m.bookmarks.length <= 10000 &&
          new Set(m.bookmarks.map((b: any) => b.id)).size === m.bookmarks.length,
      );
      assert(
        m.bookmarks.every(
          (b: any) => safeText(b.id, 100) && safeText(b.label, 100) && time(b.start),
        ),
      );
    }
    if (m.insights !== undefined) {
      const value = m.insights;
      assert(
        value &&
          Number.isInteger(value.revision) &&
          value.revision >= 0 &&
          time(value.createdAt) &&
          safeText(value.model, 200) &&
          Number.isInteger(value.rejected) &&
          value.rejected >= 0,
      );
      const insightIds = new Set<string>();
      for (const key of ['highlights', 'decisions', 'questions', 'tasks']) {
        assert(Array.isArray(value[key]) && value[key].length <= 100);
        for (const item of value[key]) {
          assert(
            item &&
              safeText(item.id, 100) &&
              !insightIds.has(item.id) &&
              safeText(item.text, 2000) &&
              safeText(item.segmentId, 100) &&
              safeText(item.quote, 100000),
          );
          assert(item.assignee === undefined || safeText(item.assignee, 120));
          assert(item.dueText === undefined || safeText(item.dueText, 120));
          insightIds.add(item.id);
          if (value.revision === m.revision)
            assert(
              m.segments.some((s: any) => s.id === item.segmentId && s.text.includes(item.quote)),
            );
        }
      }
    }
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
export async function readBackup(file: File) {
  try {
    return await parseBackup(file);
  } catch (error) {
    if (error instanceof Error && /^(Die Sicherung|Die entpackte Sicherung)/.test(error.message))
      throw error;
    throw new Error(
      'Die Sicherung ist beschädigt oder hat ein unbekanntes Format. Vorhandene Gespräche bleiben unverändert.',
    );
  }
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
