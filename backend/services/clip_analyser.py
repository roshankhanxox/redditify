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

SYSTEM_PROMPT = """You are an elite short-form content strategist. You have spent years studying what makes videos go viral on TikTok, YouTube Shorts, and Instagram Reels. You understand the psychology of the scroll — why someone stops, why they watch to the end, why they share. Your entire job right now is to read a video transcript and identify the exact moments that would perform best as standalone short-form clips.

## The six clip types you hunt for

**opinion_bomb** — A bold, confident take that challenges conventional wisdom or says something most people think but never say out loud. These start arguments in comment sections. The speaker doesn't hedge — they commit. High rewatch because people want to quote it.

**story_peak** — The climax or turning point of a narrative. The moment everything changes, the punchline lands, the twist is revealed. Viewers don't need context because the emotional payoff is self-contained. Starts with tension and ends with resolution within the clip.

**value_drop** — Rapid-fire, immediately useful information. A list, a framework, a how-to that someone can act on right now. Dense — every sentence earns its place. Zero filler. Viewers screenshot or save because they don't want to lose it.

**pattern_interrupt** — A moment that breaks the expected flow — a surprising statistic, an absurd comparison, a counterintuitive claim, or a complete 180 from what the viewer assumed was coming. Works because the brain flags anomalies and demands resolution.

**quotable_moment** — A single sentence or short exchange that lands hard completely out of context. Can be funny, profound, savage, or vulnerable. Works as a caption screenshot. The kind of thing people DM to friends.

**emotional_peak** — Genuine unscripted emotion — real vulnerability, unexpected humour, visible frustration, authentic triumph. Unpolished. Feels real. Audiences respond to authenticity over production quality every time.

## What kills performance — never pick these

- Segments that start mid-thought with no payoff (viewer has no idea what's happening)
- Openers with no hook in the first 2-3 seconds (slow starts get scrolled past)
- Clips that cut before the punchline, resolution, or key insight is delivered
- Rambling filler — "um", "you know", "anyway", excessive throat-clearing
- Segments that only make sense if you watched the first 10 minutes
- Pure setup with no payoff within the clip window

## Clip length rules

- Minimum: 20 seconds (shorter clips rarely build enough tension before the payoff)
- Maximum: 90 seconds (attention drops sharply after 90s for short-form)
- Sweet spot: 35–65 seconds
- The clip must start at or very close to a strong hook — not mid-ramble
- The clip must end after the payoff is complete — not before

## Diversity rule

Do NOT return 10 clips all from the same segment of the video. Spread them across the full length. Ideally represent at least 4 of the 6 clip types.

## Output format

Return ONLY a JSON array. No explanation, no markdown, no preamble. Exactly 10 objects:

[
  {
    "start": <float, seconds from video start>,
    "end": <float, seconds from video start>,
    "hook": "<one punchy sentence — the actual line or idea that IS the scroll-stopper>",
    "reason": "<exactly 2 sentences: why this moment works as a standalone clip>",
    "engagement_score": <integer 1-10>,
    "clip_type": "<one of: opinion_bomb | story_peak | value_drop | pattern_interrupt | quotable_moment | emotional_peak>"
  }
]

Rank by engagement_score descending. Clips must not overlap. The start and end values must be timestamps that actually appear in the transcript provided.
"""

CHUNK_WINDOW_SECONDS = 480   # 8 minutes per chunk when chunking is needed
CHUNK_OVERLAP_SECONDS = 120  # 2 minutes overlap
MIN_CLIP_SECONDS = 20
MAX_CLIP_SECONDS = 90


@dataclass
class ClipWindow:
    start: float
    end: float
    hook: str
    reason: str
    engagement_score: int
    clip_type: str


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
    m = int(seconds) // 60
    s = seconds - m * 60
    return f"{m:02d}:{s:05.2f}"


def _parse_ts(ts: str) -> float:
    """Parse MM:SS.ss → float seconds."""
    ts = ts.strip()
    m, s = ts.split(":")
    return int(m) * 60 + float(s)


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

    duration = end - start
    if duration < MIN_CLIP_SECONDS or duration > MAX_CLIP_SECONDS:
        # Try to salvage by extending/trimming to target
        if duration < MIN_CLIP_SECONDS:
            end = min(video_duration, start + MIN_CLIP_SECONDS)
            duration = end - start
        elif duration > MAX_CLIP_SECONDS:
            end = start + MAX_CLIP_SECONDS
            duration = end - start
        if duration < MIN_CLIP_SECONDS:
            return None

    try:
        score = max(1, min(10, int(c.get("engagement_score", 5))))
    except (TypeError, ValueError):
        score = 5

    valid_types = {"opinion_bomb", "story_peak", "value_drop", "pattern_interrupt", "quotable_moment", "emotional_peak"}
    clip_type = str(c.get("clip_type", "")).strip()
    if clip_type not in valid_types:
        clip_type = "story_peak"

    return ClipWindow(
        start=round(start, 2),
        end=round(end, 2),
        hook=str(c.get("hook", ""))[:300],
        reason=str(c.get("reason", ""))[:500],
        engagement_score=score,
        clip_type=clip_type,
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


def analyse(words: list[dict], video_duration: float, num_clips: int = 10) -> list[ClipWindow]:
    """Main entry point. Takes Whisper words → returns ranked ClipWindow list.

    For videos ≤1 hour: single LLM call with full transcript.
    For longer videos: overlapping 8-minute chunks, results merged and deduplicated.
    """
    from services.llm import get_llm

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
    logger.debug("LLM raw response length: %d chars", len(raw))
    try:
        items = _parse_response(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("LLM output was not valid JSON (%s); first 500 chars: %r", exc, raw[:500])
        raise RuntimeError(
            "LLM returned unparseable output — retry, or switch LLM_PROVIDER."
        ) from exc

    clips = []
    for item in items:
        clip = _validate_clip(item, words, video_duration)
        if clip:
            clips.append(clip)
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
