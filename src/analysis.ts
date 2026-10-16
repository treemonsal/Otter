import type { Meeting, Segment } from './types';
export function clock(seconds: number) {
  if (!Number.isFinite(seconds)) seconds = 0;
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}
export function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat('de-CH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(timestamp);
}
export function transcript(meeting: Meeting) {
  return meeting.segments.map((s) => s.text.trim()).join(' ');
}
const stopwords = new Set(
  'aber alle alles als also am an auch auf aus bei das dass dem den der des die dieser dies doch du ein eine einer eines er es für hat haben hier ich im in ist ja kann kein man mehr mit nach nicht noch nun oder ohne sein sie sind so über um und uns vom von vor war was wenn werden wie wir wird zu zum zur the a an and are as at be by for from has have i in is it of on or that this to was we will with you'.split(
    ' ',
  ),
);
function tokens(text: string) {
  return (
    text
      .toLocaleLowerCase('de')
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter((w) => !stopwords.has(w)) || []
  );
}
export function summary(segments: Segment[]): Segment[] {
  const useful = segments.filter((s) => s.text.trim().length > 15);
  const frequencies = new Map<string, number>();
  useful.forEach((s) =>
    new Set(tokens(s.text)).forEach((w) => frequencies.set(w, (frequencies.get(w) || 0) + 1)),
  );
  return useful
    .map((s, i) => ({
      s,
      i,
      score:
        tokens(s.text).reduce((n, w) => n + (frequencies.get(w) || 0), 0) /
        Math.sqrt(Math.max(1, tokens(s.text).length)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}
export function proposedTasks(segments: Segment[]): string[] {
  const pattern =
    /\b(muss|müssen|soll|sollen|werde|werden|bitte|erledigen|schicke|sende|prüfe|übernehme|kümmere|to-?do|need to|will|please|should|action item|follow up)\b/i;
  return [
    ...new Set(
      segments
        .flatMap((s) => s.text.split(/(?<=[.!?])\s+/))
        .map((t) => t.trim())
        .filter((t) => t.length > 10 && pattern.test(t)),
    ),
  ].slice(0, 20);
}
export function findEvidence(segments: Segment[], query: string) {
  const words = [...new Set(tokens(query))];
  if (!words.length) return [];
  return segments
    .map((s) => ({
      segment: s,
      score: words.filter((w) => s.text.toLocaleLowerCase('de').includes(w)).length,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.segment);
}
function srtTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${Math.floor(ms / 3600000)
    .toString()
    .padStart(2, '0')}:${Math.floor((ms / 60000) % 60)
    .toString()
    .padStart(2, '0')}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, '0')},${(ms % 1000).toString().padStart(3, '0')}`;
}
export function toSrt(segments: Segment[]) {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.speaker ? s.speaker + ': ' : ''}${s.text}\n`,
    )
    .join('\n');
}
export function toMarkdown(m: Meeting) {
  return `# ${m.title}\n\n${dateLabel(m.createdAt)} · ${clock(m.duration)}\n\n## Transkript\n\n${m.segments.map((s) => `[${clock(s.start)}] ${s.speaker ? s.speaker + ': ' : ''}${s.text}`).join('\n\n')}\n\n## Notizen\n\n${m.notes}\n\n## Aufgaben\n\n${m.tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n')}\n`;
}
