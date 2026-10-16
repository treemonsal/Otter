export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
}
export interface Task {
  id: string;
  text: string;
  done: boolean;
}
export interface Meeting {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  audio?: Blob;
  segments: Segment[];
  notes: string;
  tasks: Task[];
  folder: string;
  starred: boolean;
  deletedAt?: number;
  revision: number;
}
export interface Settings {
  consent: boolean;
  language: 'german' | 'english' | 'french' | 'italian' | 'auto';
  folders: string[];
}
export const defaultSettings: Settings = {
  consent: false,
  language: 'german',
  folders: ['Arbeit', 'Persönlich'],
};
export const newMeeting = (title: string): Meeting => ({
  id: crypto.randomUUID(),
  title,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  duration: 0,
  segments: [],
  notes: '',
  tasks: [],
  folder: '',
  starred: false,
  revision: 0,
});
