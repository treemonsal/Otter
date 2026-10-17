export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
  speakerUncertain?: boolean;
}
export interface Task {
  id: string;
  text: string;
  done: boolean;
  assignee?: string;
  dueText?: string;
  dueDate?: string;
  segmentId?: string;
  quote?: string;
  sourceRevision?: number;
}
export interface InsightItem {
  id: string;
  text: string;
  segmentId: string;
  quote: string;
  assignee?: string;
  dueText?: string;
}
export interface Insights {
  revision: number;
  createdAt: number;
  model: string;
  rejected: number;
  highlights: InsightItem[];
  decisions: InsightItem[];
  questions: InsightItem[];
  tasks: InsightItem[];
}
export interface Bookmark {
  id: string;
  start: number;
  label: string;
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
  transcriptionSource?:
    'local-whisper-tiny' | 'cloud-whisper-large-v3' | 'murmur-ai' | 'browser-live';
  insights?: Insights;
  bookmarks?: Bookmark[];
  liveSegments?: Segment[];
}
export interface Settings {
  consent: boolean;
  language: 'german' | 'english' | 'french' | 'italian' | 'auto';
  folders: string[];
  serviceUrl: string;
}
export const defaultSettings: Settings = {
  consent: false,
  language: 'german',
  folders: ['Arbeit', 'Persönlich'],
  serviceUrl: import.meta.env.VITE_AI_SERVICE_URL || '',
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
