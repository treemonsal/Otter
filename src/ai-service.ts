import type { Insights, Segment, InsightItem, Meeting, Settings } from './types';
import { db, changed } from './db';
export type JobKind = 'transcription' | 'analysis';
export interface AiJob {
  id: string;
  meetingId: string;
  kind: JobKind;
  endpoint: string;
  remoteId?: string;
  revision: number;
  sourceSegments?: Segment[];
  audioSize: number;
  language: string;
  duration: number;
  completedSeconds: number;
  segments: Segment[];
  prefix: Segment[];
  prototypes: number[][];
  insights?: Insights;
  status: 'paused' | 'running' | 'complete';
  message: string;
  owner?: string;
  leaseUntil?: number;
}
export function serviceUrl(input: string) {
  const url = new URL(input.trim());
  const local =
    ['localhost', '127.0.0.1'].includes(location.hostname) &&
    ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Bitte gib eine HTTPS-Adresse ohne Zugangsdaten, Suchparameter oder Fragment an.',
    );
  return url.href.replace(/\/$/, '');
}
export async function serviceRequest(
  endpoint: string,
  path: string,
  signal?: AbortSignal,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 30000);
  try {
    const response = await fetch(serviceUrl(endpoint) + path, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 404
          ? 'Der Serverauftrag ist abgelaufen.'
          : response.status === 429
            ? 'Der KI-Dienst ist ausgelastet. Bitte später fortsetzen.'
            : 'Der KI-Dienst konnte die Anfrage nicht verarbeiten.',
      );
      Object.assign(error, { status: response.status });
      throw error;
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (text.length > 12 * 1024 * 1024) throw new Error('Die Serverantwort ist zu gross.');
    return JSON.parse(text);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Pausiert', 'AbortError');
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === 'AbortError')
    )
      throw new Error(
        'Verbindung unterbrochen. Dein Zwischenstand ist gespeichert; du kannst den Auftrag fortsetzen.',
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function checkService(endpoint: string) {
  const result = await serviceRequest(endpoint, '/health');
  if (
    result?.service !== 'murmur-ai' ||
    result.version !== 1 ||
    !Array.isArray(result.capabilities) ||
    !['transcription', 'speakers', 'insights'].every((c) => result.capabilities.includes(c))
  )
    throw new Error('Diese Adresse bietet keinen kompatiblen Murmur-KI-Dienst.');
  return result as {
    maxSeconds: number;
    models: { speech: string; speakers: string; insights: string };
    retentionHours: number;
  };
}
export const allJobs = async (): Promise<AiJob[]> => (await db).getAll('jobs');
export async function deleteJob(id: string) {
  await (await db).delete('jobs', id);
  changed();
}
export async function claimJob(candidate: AiJob, owner: string, ownsLock = false): Promise<AiJob> {
  const tx = (await db).transaction('jobs', 'readwrite');
  const old: AiJob | undefined = await tx.store.get(candidate.id);
  if (!ownsLock && old?.owner && old.owner !== owner && (old.leaseUntil || 0) > Date.now()) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('Dieser Auftrag läuft bereits in einem anderen Fenster.');
  }
  const next = { ...(old || candidate), owner, leaseUntil: Date.now() + 20000 };
  await tx.store.put(next);
  await tx.done;
  changed();
  return next;
}
export async function saveJob(job: AiJob, owner: string, release = false) {
  const tx = (await db).transaction('jobs', 'readwrite');
  const old: AiJob | undefined = await tx.store.get(job.id);
  if (old?.owner !== owner) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('Der Auftrag wurde in einem anderen Fenster übernommen.');
  }
  const next = {
    ...job,
    owner: release ? undefined : owner,
    leaseUntil: release ? 0 : Date.now() + 20000,
  };
  await tx.store.put(next);
  await tx.done;
  changed();
  return next;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function parseSegments(value: unknown, duration: number): Segment[] {
  if (!Array.isArray(value) || value.length > 50000)
    throw new Error('Ungültige Textstellen vom KI-Dienst.');
  const ids = new Set<string>();
  return value.map((s) => {
    if (
      !s ||
      typeof s.id !== 'string' ||
      s.id.length > 100 ||
      ids.has(s.id) ||
      typeof s.text !== 'string' ||
      s.text.length > 100000 ||
      typeof s.speaker !== 'string' ||
      s.speaker.length > 100 ||
      !finite(s.start) ||
      !finite(s.end) ||
      s.end < s.start ||
      s.end > duration + 0.1 ||
      (s.speakerUncertain !== undefined && typeof s.speakerUncertain !== 'boolean')
    )
      throw new Error('Ungültige Textstelle vom KI-Dienst.');
    ids.add(s.id);
    return {
      id: s.id,
      text: s.text,
      start: s.start,
      end: Math.min(s.end, duration),
      speaker: s.speaker,
      speakerUncertain: s.speakerUncertain,
    };
  });
}
export function parseInsights(value: unknown, segments: Segment[], revision: number): Insights {
  const input = value as Record<string, unknown>;
  if (!input || typeof input.model !== 'string' || input.model.length > 200)
    throw new Error('Ungültige KI-Auswertung.');
  const source = new Map(segments.map((s) => [s.id, s]));
  let rejected = typeof input.rejected === 'number' && finite(input.rejected) ? input.rejected : 0;
  const result = {
    revision,
    createdAt: Date.now(),
    model: input.model,
    rejected,
    highlights: [],
    decisions: [],
    questions: [],
    tasks: [],
  } as Insights;
  for (const key of ['highlights', 'decisions', 'questions', 'tasks'] as const) {
    if (!Array.isArray(input[key]) || input[key].length > 100)
      throw new Error('Ungültige KI-Auswertung.');
    for (const raw of input[key]) {
      const s = source.get(raw?.segmentId);
      if (
        !s ||
        typeof raw.text !== 'string' ||
        raw.text.trim().length < 8 ||
        raw.text.trim() === raw.segmentId ||
        raw.text.length > 2000 ||
        typeof raw.quote !== 'string' ||
        raw.quote.trim().length < 8 ||
        !s.text.includes(raw.quote)
      ) {
        rejected++;
        continue;
      }
      const item: InsightItem = {
        id: crypto.randomUUID(),
        text: raw.text.trim(),
        segmentId: s.id,
        quote: raw.quote,
      };
      if (key === 'tasks') {
        item.assignee =
          typeof raw.assignee === 'string' &&
          raw.assignee.length <= 120 &&
          (raw.quote.toLocaleLowerCase().includes(raw.assignee.toLocaleLowerCase()) ||
            raw.assignee === s.speaker)
            ? raw.assignee
            : '';
        item.dueText =
          typeof raw.dueText === 'string' &&
          raw.dueText.length <= 120 &&
          raw.quote.toLocaleLowerCase().includes(raw.dueText.toLocaleLowerCase())
            ? raw.dueText
            : '';
      }
      result[key].push(item);
    }
  }
  result.rejected = rejected;
  return result;
}
const languageCodes: Record<Settings['language'], string> = {
  german: 'de',
  english: 'en',
  french: 'fr',
  italian: 'it',
  auto: 'auto',
};
export function newJob(m: Meeting, kind: JobKind, settings: Settings): AiJob {
  return {
    id: `${kind}:${m.id}`,
    meetingId: m.id,
    kind,
    endpoint: serviceUrl(settings.serviceUrl),
    revision: m.revision,
    sourceSegments: kind === 'analysis' ? m.segments.map((s) => ({ ...s })) : undefined,
    audioSize: m.audio?.size || 0,
    language: languageCodes[settings.language],
    duration: m.duration,
    completedSeconds: 0,
    segments: [],
    prefix: [],
    prototypes: [],
    status: 'paused',
    message: 'Bereit zum Start',
  };
}
export async function runServiceJob(
  initial: AiJob,
  meeting: Meeting,
  signal: AbortSignal,
  update: (job: AiJob) => Promise<void>,
): Promise<AiJob> {
  let job: AiJob = { ...initial, status: 'running' };
  const post = (path: string, data?: unknown) =>
    serviceRequest(job.endpoint, path, signal, {
      method: 'POST',
      ...(data
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
        : {}),
    });
  if (job.kind === 'transcription' && (!meeting.audio || meeting.audio.size !== job.audioSize))
    throw new Error('Die Aufnahme hat sich geändert. Beginne einen neuen Auftrag.');
  let remote: any;
  if (job.remoteId) {
    try {
      remote = await serviceRequest(job.endpoint, `/v1/jobs/${job.remoteId}`, signal);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      job = { ...job, remoteId: undefined, prefix: job.segments };
    }
  }
  if (!job.remoteId) {
    const payload =
      job.kind === 'transcription'
        ? {
            kind: job.kind,
            bytes: job.audioSize,
            language: job.language,
            startAt: job.completedSeconds,
            prototypes: job.prototypes,
          }
        : {
            kind: job.kind,
            segments: (job.sourceSegments || meeting.segments).map(
              ({ id, text, speaker, start, end }) => ({ id, text, speaker, start, end }),
            ),
          };
    remote = await post('/v1/jobs', payload);
    if (typeof remote?.id !== 'string' || !/^[\w-]{32,64}$/.test(remote.id))
      throw new Error('Ungültiger Serverauftrag.');
    job = { ...job, remoteId: remote.id };
    await update(job);
  }
  const base = `/v1/jobs/${job.remoteId}`;
  if (remote.status === 'uploading') {
    const blob = meeting.audio!;
    const chunk = 2 * 1024 * 1024;
    const count = Math.ceil(blob.size / chunk);
    const received = new Set(Array.isArray(remote.uploaded) ? remote.uploaded : []);
    for (let i = 0; i < count; i++)
      if (!received.has(i)) {
        job = { ...job, message: `Audio senden · ${Math.round((i / count) * 100)} %` };
        await update(job);
        await serviceRequest(job.endpoint, `${base}/audio/${i}`, signal, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob.slice(i * chunk, (i + 1) * chunk),
        });
      }
  }
  if (['uploading', 'paused', 'error'].includes(remote.status))
    remote = await post(`${base}/start`);
  const started = Date.now();
  while (true) {
    if (signal.aborted) throw new DOMException('Pausiert', 'AbortError');
    if (Date.now() - started > 4 * 60 * 60 * 1000)
      throw new Error(
        'Der Auftrag wartet seit vier Stunden. Zwischenstand gespeichert; bitte später fortsetzen.',
      );
    if (
      !remote ||
      !['uploading', 'queued', 'processing', 'paused', 'error', 'complete'].includes(remote.status)
    )
      throw new Error('Ungültiger Auftragsstatus.');
    if (remote.status === 'error' || remote.status === 'paused')
      throw new Error(
        typeof remote.error === 'string' && remote.error
          ? remote.error
          : 'Der Serverauftrag ist pausiert. Bitte fortsetzen.',
      );
    if (job.kind === 'transcription') {
      const duration =
        finite(remote.duration) && remote.duration <= 3600.05 ? remote.duration : job.duration;
      if (!finite(remote.completedSeconds) || remote.completedSeconds > duration + 0.1)
        throw new Error('Ungültiger Zwischenstand.');
      const values = parseSegments(remote.segments, duration);
      if (
        !Array.isArray(remote.prototypes) ||
        remote.prototypes.length > 20 ||
        remote.prototypes.some(
          (p: unknown) =>
            !Array.isArray(p) ||
            p.length !== 512 ||
            p.some((x) => typeof x !== 'number' || !Number.isFinite(x)),
        )
      )
        throw new Error('Ungültiger Sprecher-Zwischenstand.');
      job = {
        ...job,
        segments: [...job.prefix, ...values],
        duration,
        completedSeconds: remote.completedSeconds,
        prototypes: remote.prototypes,
      };
    }
    job = {
      ...job,
      message:
        typeof remote.message === 'string'
          ? remote.message.slice(0, 300)
          : 'KI-Dienst verarbeitet …',
    };
    if (remote.status === 'complete') {
      if (job.kind === 'analysis')
        job = {
          ...job,
          insights: parseInsights(
            remote.insights,
            job.sourceSegments || meeting.segments,
            job.revision,
          ),
        };
      else if (!job.segments.length) throw new Error('Keine Sprache erkannt. Prüfe die Aufnahme.');
      job = { ...job, status: 'complete' };
      await update(job);
      return job;
    }
    await update(job);
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Pausiert', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 2000);
      signal.addEventListener('abort', abort, { once: true });
    });
    remote = await serviceRequest(job.endpoint, base, signal);
  }
}
export async function renewJob(id: string, owner: string) {
  const tx = (await db).transaction('jobs', 'readwrite');
  const old: AiJob | undefined = await tx.store.get(id);
  if (old?.owner === owner) await tx.store.put({ ...old, leaseUntil: Date.now() + 20000 });
  await tx.done;
}
