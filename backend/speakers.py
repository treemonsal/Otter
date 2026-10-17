"""Anonymous speaker grouping from neural voice embeddings, never from text/names."""

import numpy as np


class Speakers:
    def __init__(self, prototypes=None):
        self.prototypes = [np.array(p, dtype=np.float32) for p in (prototypes or [])]

    def identify(self, embedding, seconds):
        if embedding is None or seconds < 0.75:
            return "", True
        norm = np.linalg.norm(embedding)
        if not np.isfinite(norm) or norm < 1e-8:
            return "", True
        value = embedding / norm
        scores = [float(np.dot(value, p)) for p in self.prototypes]
        best = int(np.argmax(scores)) if scores else -1
        score = scores[best] if scores else -1
        if score < 0.6 and len(self.prototypes) < 20:
            self.prototypes.append(value)
            return f"Sprecher {len(self.prototypes)}", seconds < 1.5
        if best < 0:
            return "", True
        if score >= 0.75:
            updated = self.prototypes[best] * 0.9 + value * 0.1
            self.prototypes[best] = updated / np.linalg.norm(updated)
        return f"Sprecher {best + 1}", score < 0.75 or seconds < 1.5

    def state(self):
        return [p.tolist() for p in self.prototypes]


def transcribe_block(audio, offset, language, speakers, models):
    # Neural turn segmentation and global voice matching; Whisper supplies real word timings.
    turns = models.diarize(audio)
    groups = {}
    for turn in turns:
        groups.setdefault(turn.speaker, []).append(
            audio[int(turn.start * 16000) : int(turn.end * 16000)]
        )
    labels = {}
    for identity, pieces in groups.items():
        voiced = np.concatenate(pieces)[: 30 * 16000]
        embedding = models.embedding(voiced) if len(voiced) >= 12000 else None
        labels[identity] = speakers.identify(embedding, len(voiced) / 16000)
    detected, _ = models.speech().transcribe(
        audio,
        language=None if language == "auto" else language,
        beam_size=3,
        word_timestamps=True,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    result = []
    for segment in detected:
        for word in segment.words or []:
            overlaps = [
                (max(0, min(word.end, t.end) - max(word.start, t.start)), t)
                for t in turns
            ]
            overlaps.sort(key=lambda item: item[0], reverse=True)
            best = overlaps[0] if overlaps else None
            label, uncertain = (
                labels[best[1].speaker] if best and best[0] > 0 else ("", True)
            )
            overlapping = (
                len(overlaps) > 1
                and overlaps[1][0] > 0.1
                and overlaps[1][1].speaker != best[1].speaker
            )
            item = {
                "start": float(offset + word.start),
                "end": float(offset + word.end),
                "text": word.word.strip(),
                "speaker": label,
                "speakerUncertain": bool(uncertain or overlapping),
            }
            if not item["text"]:
                continue
            if (
                result
                and result[-1]["speaker"] == item["speaker"]
                and item["start"] - result[-1]["end"] < 0.8
                and item["end"] - result[-1]["start"] < 20
            ):
                result[-1]["text"] += " " + item["text"]
                result[-1]["end"] = item["end"]
                result[-1]["speakerUncertain"] |= item["speakerUncertain"]
            else:
                result.append(item)
    return result
