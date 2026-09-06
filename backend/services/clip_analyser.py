"""Clip engagement analyser.

Takes Whisper word-level timestamps, formats a timestamped transcript, sends it to
the configured LLM with an elaborate engagement-focused system prompt, parses the
JSON response, and validates/snaps timestamps to real word boundaries.
"""

from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a short-form video editor. Your job is to extract the best standalone clips from a podcast or interview transcript.

## What to extract

Look for two things only:

1. **Q&A moments** — A question asked by the host or guest, followed by the full answer. The clip begins at the question (or 1–2 sentences before it if that context helps the viewer understand why the question is being asked) and ends only when the answer is fully complete. Never cut an answer short.

2. **Self-contained stories** — A narrative with a clear beginning, middle, and end that a cold viewer can follow without any prior context. The clip starts at the first sentence of the story and ends at the natural conclusion.

Do not extract:
- Greetings, intros, sign-offs, or "thanks for having me" moments
- Filler or transitions with no substance
- Moments that only make sense if you watched the 10 minutes before them

## Clip length

- Aim for 40–120 seconds per clip. Most good Q&A exchanges fall in this range naturally.
- There is no hard maximum — if a story or answer runs 3 minutes and is genuinely great, include it in full. Never cut before the payoff just to stay short.
- Minimum 20 seconds.

## Timestamp rules — read carefully

- The transcript contains timestamps as plain decimal seconds, e.g. [6.34 → 23.54].
- Your start and end values in the JSON **must be taken directly from timestamps that appear in the transcript**. Do not calculate, interpolate, or invent timestamps.
- start = the timestamp of the first word of the clip (a decimal number like 6.34)
- end = the timestamp of the last word of the clip (a decimal number like 319.74)
- Both must be plain decimal numbers — no colons, no units, just the number.

## Coverage

Read the entire transcript before selecting anything. Divide the video into thirds and ensure at least one clip comes from each third. Do not return clips only from the beginning.

## No overlaps

Sort your final list by start time. Each clip's start must be after the previous clip's end. If two candidates overlap, keep the stronger one.

## How many clips

Return 1 clip per 6 minutes of video, minimum 5, maximum 20. A 13-minute video → 5 clips. A 60-minute video → 10 clips.

## Output

Return ONLY a valid JSON array — no markdown, no explanation, no preamble.

[
  {
    "start": <float, seconds — must exist verbatim in the transcript>,
    "end": <float, seconds — must exist verbatim in the transcript>,
    "opening_line": "<exact first words of this clip, copied from the transcript>",
    "closing_line": "<exact last words of this clip, copied from the transcript>",
    "hook": "<one sentence: the specific line or moment that makes someone stop scrolling>",
    "reason": "<two sentences: why this works as a standalone clip for a cold viewer>",
    "engagement_score": <integer 1–10>,
    "clip_type": "<qa_moment | story>"
  }
]

Rank by engagement_score descending. The opening_line and closing_line are your own check — if you cannot find those exact words at those timestamps in the transcript, your timestamps are wrong and you must correct them before returning.
"""

CHUNK_WINDOW_SECONDS = 480   # 8 minutes per chunk when chunking is needed
CHUNK_OVERLAP_SECONDS = 120  # 2 minutes overlap
MIN_CLIP_SECONDS = 20
MIN_CLIP_SECONDS_QUOTABLE = 8


@dataclass
class ClipWindow:
    start: float
    end: float
    hook: str
    reason: str
    engagement_score: int
    clip_type: str
    opening_line: str = ""
    closing_line: str = ""
    context_dependency: str = "low"
    natural_end: bool = True


def _format_transcript(words: list[dict], offset: float = 0.0) -> str:
    """Format Whisper word list as a timestamped transcript for the LLM.

    Each line: [MM:SS.t] word
    Groups words into sentence-like lines for readability without losing
    per-word timestamp granularity.
    """
    if not words:
        return ""

    lines = []
    line_words: list[str] = []
    line_start: float | None = None
    line_end: float = 0.0

    for w in words:
        t_start = w.get("start", 0.0) + offset
        t_end = w.get("end", t_start + 0.3) + offset
        text = w.get("word", "").strip()
        if not text:
            continue

        if line_start is None:
            line_start = t_start
        line_words.append(text)
        line_end = t_end

        # Break on sentence-ending punctuation or every ~12 words
        if text.endswith((".", "!", "?", "...")) or len(line_words) >= 12:
            ts = _fmt_ts(line_start)
            te = _fmt_ts(line_end)
            lines.append(f"[{ts} → {te}] {' '.join(line_words)}")
            line_words = []
            line_start = None

    if line_words and line_start is not None:
        ts = _fmt_ts(line_start)
        te = _fmt_ts(line_end)
        lines.append(f"[{ts} → {te}] {' '.join(line_words)}")

    return "\n".join(lines)


def _fmt_ts(seconds: float) -> str:
    return f"{seconds:.2f}"


def _parse_ts(ts: str) -> float:
    """Parse float seconds string → float. Handles legacy MM:SS format too."""
    ts = ts.strip()
    if ":" in ts:
        m, s = ts.split(":")
        return int(m) * 60 + float(s)
    return float(ts)


def _parse_response(raw: str) -> list[dict]:
    """Extract JSON array from LLM response, tolerating markdown fences."""
    raw = raw.strip()
    # Strip markdown code fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
    # Find first [ ... ] block
    m = re.search(r"\[.*\]", raw, re.DOTALL)
    if m:
        raw = m.group(0)
    return json.loads(raw)


def _snap_to_word_boundary(seconds: float, words: list[dict], snap: str = "nearest") -> float:
    """Snap a float timestamp to the nearest real word boundary in the Whisper output."""
    if not words:
        return seconds
    boundaries = []
    for w in words:
        boundaries.append(w.get("start", 0.0))
        boundaries.append(w.get("end", 0.0))
    boundaries.sort()
    if snap == "floor":
        valid = [b for b in boundaries if b <= seconds]
        return valid[-1] if valid else boundaries[0]
    if snap == "ceil":
        valid = [b for b in boundaries if b >= seconds]
        return valid[0] if valid else boundaries[-1]
    # nearest
    return min(boundaries, key=lambda b: abs(b - seconds))


def _validate_clip(c: dict, words: list[dict], video_duration: float) -> ClipWindow | None:
    """Validate and snap a raw LLM clip dict. Returns None to discard bad clips."""
    try:
        start = float(c["start"])
        end = float(c["end"])
    except (KeyError, TypeError, ValueError):
        return None

    # Snap to real word boundaries
    start = _snap_to_word_boundary(start, words, "floor")
    end = _snap_to_word_boundary(end, words, "ceil")

    # Clamp to video duration
    start = max(0.0, start)
    end = min(video_duration, end)

    min_dur = MIN_CLIP_SECONDS

    duration = end - start
    if duration < min_dur:
        end = min(video_duration, start + min_dur)
        duration = end - start
        if duration < min_dur:
            return None

    try:
        score = max(1, min(10, int(c.get("engagement_score", 5))))
    except (TypeError, ValueError):
        score = 5

    valid_types = {"qa_moment", "story", "opinion_bomb", "story_peak", "value_drop", "pattern_interrupt", "quotable_moment", "emotional_peak"}
    clip_type = str(c.get("clip_type", "")).strip()
    if clip_type not in valid_types:
        clip_type = "story"

    valid_context = {"low", "medium", "high"}
    context_dep = str(c.get("context_dependency", "low")).strip()
    if context_dep not in valid_context:
        context_dep = "low"

    natural_end = c.get("natural_end", True)
    if not isinstance(natural_end, bool):
        natural_end = str(natural_end).lower() != "false"

    return ClipWindow(
        start=float(round(start, 2)),
        end=float(round(end, 2)),
        hook=str(c.get("hook", ""))[:300],
        reason=str(c.get("reason", ""))[:500],
        engagement_score=score,
        clip_type=clip_type,
        opening_line=str(c.get("opening_line", ""))[:300],
        closing_line=str(c.get("closing_line", ""))[:300],
        context_dependency=context_dep,
        natural_end=natural_end,
    )


def _deduplicate(clips: list[ClipWindow]) -> list[ClipWindow]:
    """Remove overlapping clips, keeping the higher-scored one."""
    clips = sorted(clips, key=lambda c: -c.engagement_score)
    kept: list[ClipWindow] = []
    for clip in clips:
        overlaps = any(
            not (clip.end <= k.start or clip.start >= k.end)
            for k in kept
        )
        if not overlaps:
            kept.append(clip)
    return sorted(kept, key=lambda c: -c.engagement_score)


def analyse(words: list[dict], video_duration: float, num_clips: int | None = None) -> list[ClipWindow]:
    """Main entry point. Takes Whisper words → returns ranked ClipWindow list.

    For videos ≤1 hour: single LLM call with full transcript.
    For longer videos: overlapping 8-minute chunks, results merged and deduplicated.
    """
    from services.llm import get_llm

    if num_clips is None:
        # 1 clip per 6 minutes, clamped to [5, 20]
        num_clips = max(5, min(20, math.ceil(video_duration / 360)))

    logger.info(
        "clip_analyser: starting — video_duration=%.1fs (%.1f min) target_clips=%d words=%d",
        video_duration, video_duration / 60, num_clips, len(words),
    )
    llm = get_llm()

    if video_duration <= 3600:
        transcript = _format_transcript(words)
        clips = _call_llm(llm, transcript, words, video_duration)
    else:
        clips = _analyse_chunked(llm, words, video_duration)

    clips = _deduplicate(clips)
    return clips[:num_clips]


def _call_llm(llm, transcript: str, words: list[dict], video_duration: float) -> list[ClipWindow]:
    user_msg = (
        f"Video duration: {_fmt_ts(video_duration)}\n\n"
        f"Transcript:\n{transcript}"
    )
    # Provider errors (auth, network, rate limit, SDK failures) intentionally
    # propagate — the task surfaces them verbatim as the job's error_message
    # rather than masking them as an empty result. Only a genuine parse failure
    # is handled here, and it raises a distinct, actionable message.
    raw = llm.complete(SYSTEM_PROMPT, user_msg)
    logger.info("clip_analyser: LLM response %d chars — first 800: %r", len(raw), raw[:800])
    try:
        items = _parse_response(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("LLM output was not valid JSON (%s); first 500 chars: %r", exc, raw[:500])
        raise RuntimeError(
            "LLM returned unparseable output — retry, or switch LLM_PROVIDER."
        ) from exc

    logger.info("clip_analyser: LLM returned %d raw items", len(items))
    clips = []
    for i, item in enumerate(items):
        raw_start = item.get("start")
        raw_end = item.get("end")
        raw_dur = (float(raw_end) - float(raw_start)) if raw_start is not None and raw_end is not None else None
        clip = _validate_clip(item, words, video_duration)
        if clip:
            logger.info(
                "clip_analyser: item %d ACCEPTED — type=%s start=%.1f end=%.1f dur=%.1f raw_dur=%.1f",
                i, clip.clip_type, clip.start, clip.end, clip.end - clip.start,
                raw_dur if raw_dur is not None else -1,
            )
            clips.append(clip)
        else:
            logger.info(
                "clip_analyser: item %d DISCARDED — type=%s raw_start=%s raw_end=%s raw_dur=%s",
                i, item.get("clip_type", "?"), raw_start, raw_end,
                f"{raw_dur:.1f}" if raw_dur is not None else "?",
            )
    logger.info("clip_analyser: %d/%d items passed validation", len(clips), len(items))
    return clips


def _analyse_chunked(llm, words: list[dict], video_duration: float) -> list[ClipWindow]:
    """Overlapping chunk strategy for very long videos (>1 hour)."""
    all_clips: list[ClipWindow] = []
    chunk_start = 0.0

    while chunk_start < video_duration:
        chunk_end = min(chunk_start + CHUNK_WINDOW_SECONDS, video_duration)
        chunk_words = [
            w for w in words
            if w.get("start", 0.0) >= chunk_start and w.get("end", 0.0) <= chunk_end
        ]
        if chunk_words:
            transcript = _format_transcript(chunk_words)
            clips = _call_llm(llm, transcript, chunk_words, chunk_end)
            all_clips.extend(clips)

        if chunk_end >= video_duration:
            break
        chunk_start = chunk_end - CHUNK_OVERLAP_SECONDS

    return all_clips
