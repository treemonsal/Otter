import { openDB } from 'idb';
import { defaultSettings, type Meeting, type Settings } from './types';
const db = openDB('murmur-private', 1, {
  upgrade(db) {
    db.createObjectStore('meetings', { keyPath: 'id' });
    db.createObjectStore('settings');
  },
});
const changes =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('murmur-data');
function changed() {
  changes?.postMessage('changed');
}
export function subscribeChanges(listener: () => void) {
  changes?.addEventListener('message', listener);
  return () => changes?.removeEventListener('message', listener);
}
export class ConflictError extends Error {
  constructor() {
    super(
      'Dieses Gespräch wurde inzwischen in einem anderen Fenster geändert. Deine Eingaben wurden nicht übernommen. Kopiere sie bei Bedarf und öffne die Bearbeitung erneut.',
    );
    this.name = 'ConflictError';
  }
}
export const allMeetings = async (): Promise<Meeting[]> => (await db).getAll('meetings');
export async function saveMeeting(meeting: Meeting, expectedUpdatedAt?: number) {
  const tx = (await db).transaction('meetings', 'readwrite');
  if (expectedUpdatedAt !== undefined) {
    const existing = await tx.store.get(meeting.id);
    if (!existing || existing.updatedAt !== expectedUpdatedAt) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new ConflictError();
    }
  }
  await tx.store.put(meeting);
  await tx.done;
  changed();
}
// Recording checkpoints only own audio and duration. Preserve edits made in another window.
export async function saveRecording(snapshot: Meeting): Promise<Meeting> {
  const tx = (await db).transaction('meetings', 'readwrite');
  const existing: Meeting | undefined = await tx.store.get(snapshot.id);
  const next = {
    ...(existing || snapshot),
    audio: snapshot.audio,
    duration: snapshot.duration,
    updatedAt: Math.max(Date.now(), (existing?.updatedAt || 0) + 1),
  };
  await tx.store.put(next);
  await tx.done;
  changed();
  return next;
}
export async function removeMeeting(id: string) {
  await (await db).delete('meetings', id);
  changed();
}
export const getSettings = async (): Promise<Settings> => ({
  ...defaultSettings,
  ...(await (await db).get('settings', 'preferences')),
});
export async function saveSettings(settings: Settings, previous?: Settings) {
  const tx = (await db).transaction('settings', 'readwrite');
  const current: Settings = { ...defaultSettings, ...(await tx.store.get('preferences')) };
  const next = previous
    ? {
        ...current,
        ...(settings.consent !== previous.consent ? { consent: settings.consent } : {}),
        ...(settings.language !== previous.language ? { language: settings.language } : {}),
        folders: [
          ...new Set([
            ...current.folders.filter(
              (name) => !previous.folders.includes(name) || settings.folders.includes(name),
            ),
            ...settings.folders.filter((name) => !previous.folders.includes(name)),
          ]),
        ],
      }
    : settings;
  await tx.store.put(next, 'preferences');
  await tx.done;
  changed();
}
export async function changeFolder(oldName: string, replacement: string | null) {
  const tx = (await db).transaction(['meetings', 'settings'], 'readwrite');
  const settings: Settings = {
    ...defaultSettings,
    ...(await tx.objectStore('settings').get('preferences')),
  };
  const name = replacement?.normalize('NFC').trim() || '';
  if (
    replacement !== null &&
    (!name ||
      name.length > 100 ||
      settings.folders.some(
        (f) => f !== oldName && f.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'),
      ))
  ) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('Bitte wähle einen eindeutigen Ordnernamen mit höchstens 100 Zeichen.');
  }
  let cursor = await tx.objectStore('meetings').openCursor();
  while (cursor) {
    const m: Meeting = cursor.value;
    if (m.folder === oldName)
      await cursor.update({ ...m, folder: name, updatedAt: Math.max(Date.now(), m.updatedAt + 1) });
    cursor = await cursor.continue();
  }
  settings.folders = [
    ...new Set(settings.folders.filter((f) => f !== oldName).concat(name ? [name] : [])),
  ];
  await tx.objectStore('settings').put(settings, 'preferences');
  await tx.done;
  changed();
}
export async function restoreMeetings(
  meetings: Meeting[],
  preferences?: Pick<Settings, 'language' | 'folders'>,
) {
  const tx = (await db).transaction(['meetings', 'settings'], 'readwrite');
  const store = tx.objectStore('meetings');
  let added = 0;
  for (const meeting of meetings) {
    if (!(await store.getKey(meeting.id))) {
      await store.put(meeting);
      added++;
    }
  }
  if (preferences) {
    const existing = await tx.objectStore('settings').get('preferences');
    const next = {
      ...defaultSettings,
      ...existing,
      language: preferences.language,
      folders: [
        ...new Set([...(existing?.folders || defaultSettings.folders), ...preferences.folders]),
      ],
    };
    await tx.objectStore('settings').put(next, 'preferences');
  }
  await tx.done;
  changed();
  return { added, skipped: meetings.length - added };
}
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* Optional permission cannot turn a successful data write into a failure. */
  }
  return false;
}
