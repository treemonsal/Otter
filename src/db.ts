import { openDB } from 'idb';
import { defaultSettings, type Meeting, type Settings } from './types';
const db = openDB('murmur-private', 1, {
  upgrade(db) {
    db.createObjectStore('meetings', { keyPath: 'id' });
    db.createObjectStore('settings');
  },
});
export const allMeetings = async (): Promise<Meeting[]> => (await db).getAll('meetings');
export const saveMeeting = async (meeting: Meeting) => (await db).put('meetings', meeting);
export const removeMeeting = async (id: string) => (await db).delete('meetings', id);
export const getSettings = async (): Promise<Settings> => ({
  ...defaultSettings,
  ...(await (await db).get('settings', 'preferences')),
});
export const saveSettings = async (settings: Settings) =>
  (await db).put('settings', settings, 'preferences');
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
  return { added, skipped: meetings.length - added };
}
export async function requestPersistence() {
  if (navigator.storage?.persist) return navigator.storage.persist();
  return false;
}
