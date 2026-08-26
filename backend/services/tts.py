import asyncio
import logging
import math
import os
import re
import shutil
import subprocess
import tempfile

import edge_tts
from elevenlabs import ElevenLabs

from config import settings

logger = logging.getLogger(__name__)

# Curated voice catalog — ONLY ids verified to synthesize (HTTP 200) on the
# configured API key, sourced from ElevenLabs' official premade roster plus
# its Voice Library picks that happen to be plan-included. Anything else 402s
# ("payment_required") at render time, so never add an id without testing.
VOICE_CATALOG: dict[str, dict] = {
    # --- Male · premade ---
    "brian":    {"label": "Brian · Resonant American",        "el": "nPczCjzI2devNBz1zQrb", "edge": "en-US-BrianNeural"},
    "charlie":  {"label": "Charlie · Energetic Australian",   "el": "IKne3meq5aSn9XLyUdCD", "edge": "en-AU-WilliamNeural"},
    "daniel":   {"label": "Daniel · British Broadcast",       "el": "onwK4e9ZLuTAKqWW03F9", "edge": "en-GB-RyanNeural"},
    "george":   {"label": "George · Warm British Storyteller","el": "JBFqnCBsd6RMkjVDRZzb", "edge": "en-GB-ThomasNeural"},
    "eric":     {"label": "Eric · Smooth Conversational",     "el": "cjVigY5qzO86Huf0OWal", "edge": "en-US-EricNeural"},
    "liam":     {"label": "Liam · Young & Energetic",         "el": "TX3LPaxmHKxFdv7VOQHJ", "edge": "en-US-ChristopherNeural"},
    "roger":    {"label": "Roger · Laid-back American",       "el": "CwhRBWXzGAHq8TQ4Fs17", "edge": "en-US-GuyNeural"},
    "callum":   {"label": "Callum · Dark & Gravelly",         "el": "N2lVS1w4EtoT3dr4eOWO", "edge": "en-GB-RyanNeural"},
    "harry":    {"label": "Harry · Animated & Intense",       "el": "SOYHLrjzK2X1ezoPC6cr", "edge": "en-US-GuyNeural"},
    "bill":     {"label": "Bill · Warm Documentarian",        "el": "pqHfZKP75CvOlQylNhV4", "edge": "en-US-GuyNeural"},
    # --- Male · library (plan-included) ---
    "adam":     {"label": "Adam · Deep All-Rounder",          "el": "pNInz6obpgDQGcFmaJgB", "edge": "en-US-ChristopherNeural"},
    "will":     {"label": "Will · Casual Podcast",            "el": "bIHbv24MWmeRgasZH58o", "edge": "en-US-EricNeural"},
    "antoni":   {"label": "Antoni · Smooth Articulate",       "el": "ErXwobaYiN019PkySvjV", "edge": "en-US-GuyNeural"},
    # --- Female · premade ---
    "alice":    {"label": "Alice · Friendly British",         "el": "Xb7hH8MSUJpSbSDYk0k2", "edge": "en-GB-LibbyNeural"},
    "jessica":  {"label": "Jessica · Playful & Trendy",       "el": "cgSgspJ2msm6clMCkdW9", "edge": "en-US-AnaNeural"},
    "laura":    {"label": "Laura · Sunny & Quirky",           "el": "FGY2WhTYpPnrIDTdsKH5", "edge": "en-US-AriaNeural"},
    "lily":     {"label": "Lily · Velvety British",           "el": "pFZP5JQG7iQjIQuC4Bku", "edge": "en-GB-SoniaNeural"},
    "matilda":  {"label": "Matilda · Professional Alto",      "el": "XrExE9yKIg1WjnnlVkGX", "edge": "en-US-AvaNeural"},
    "sarah":    {"label": "Sarah · Confident & Warm",         "el": "EXAVITQu4vr4xnSDxMaL", "edge": "en-US-JennyNeural"},
    # --- Neutral ---
    "river":    {"label": "River · Relaxed Androgynous",      "el": "SAz9YHcvj6GT2YYXdXww", "edge": "en-US-EmmaNeural"},
    # --- Meme ---
    "ana":      {"label": "Ana · Kid Voice",                  "el": "cgSgspJ2msm6clMCkdW9", "edge": "en-US-AnaNeural"},
    # --- Indian · Hinglish (free engine only) ---
    # en-IN neural voices read romanized Hindi ("TUMHE KYA PROBLEM HAI")
    # with the desi accent intact — the deliberately 'broken' delivery.
    # No plan-included ElevenLabs premade is verified on this key, so these
    # are edge exclusives; premium requests route to the free engine.
    "prabhat":  {"label": "Prabhat · Indian Hinglish",        "el": None, "edge": "en-IN-PrabhatNeural"},
    "neerja":   {"label": "Neerja · Indian Hinglish",         "el": None, "edge": "en-IN-NeerjaNeural"},
}

VALID_TTS_PROVIDERS = ("auto", "elevenlabs", "edge")
VALID_EXPRESSIVENESS = ("natural", "expressive", "dramatic")

# Expressiveness -> ElevenLabs voice_settings. Lower stability lets the model
# swing harder between calm and tense; style exaggerates delivery.
_EL_EXPRESSIVENESS = {
    "natural":    {"stability": 0.60, "style": 0.10},
    "expressive": {"stability": 0.40, "style": 0.30},
    "dramatic":   {"stability": 0.22, "style": 0.65},
}

# Expressiveness -> per-sentence-group prosody contour for the free engine:
# alternating pitch drift (Hz) and rate jitter (%) around the user's speed.
_EDGE_CONTOUR = {
    "natural":    {"pitch": 0, "rate": 0},
    "expressive": {"pitch": 2, "rate": 3},
    "dramatic":   {"pitch": 4, "rate": 6},
}


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?…])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()] or [text.strip()]


def _elevenlabs(text: str, voice: str, path: str, speed: float = 1.0,
                expressiveness: str = "expressive") -> str:
    client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
    voice_id = VOICE_CATALOG.get(voice, {}).get("el") or VOICE_CATALOG["daniel"]["el"]
    level = _EL_EXPRESSIVENESS.get(expressiveness, _EL_EXPRESSIVENESS["expressive"])
    audio = client.text_to_speech.convert(
        voice_id=voice_id,
        model_id="eleven_multilingual_v2",
        text=text,
        voice_settings={
            "stability": level["stability"],
            "similarity_boost": 0.85,
            "style": level["style"],
            "speed": max(0.7, min(1.2, speed)),
        },
    )
    with open(path, "wb") as f:
        for chunk in audio:
            f.write(chunk)
    return path


async def _edge(text: str, voice: str, path: str, speed: float = 1.0,
                expressiveness: str = "expressive") -> str:
    edge_voice = VOICE_CATALOG.get(voice, {}).get("edge") or VOICE_CATALOG["daniel"]["edge"]
    base_rate = int(round((speed - 1.0) * 100))
    contour = _EDGE_CONTOUR.get(expressiveness, _EDGE_CONTOUR["expressive"])
    sentences = _split_sentences(text)

    # Single flat pass when there is nothing to modulate.
    if len(sentences) < 2 or (contour["pitch"] == 0 and contour["rate"] == 0):
        communicate = edge_tts.Communicate(text, edge_voice, rate=f"{base_rate:+d}%")
        await communicate.save(path)
        return path

    # Group sentences so long stories stay at a sane number of network calls.
    per_chunk = max(3, math.ceil(len(sentences) / 25))
    groups = [" ".join(sentences[i:i + per_chunk]) for i in range(0, len(sentences), per_chunk)]

    workdir = tempfile.mkdtemp(prefix="reelbot-tts-")
    try:
        silence_path = os.path.join(workdir, "silence.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
             "-i", "anullsrc=r=24000:cl=mono", "-t", "0.22", silence_path],
            check=True, capture_output=True,
        )

        part_paths = []
        for i, chunk_text in enumerate(groups):
            wave = 1 if i % 2 == 0 else -1
            ending = chunk_text.rstrip()[-1:]
            emphasis = 1.5 if ending in ("!", "?") else (0.6 if ending == "…" else 1.0)
            pitch_hz = int(round(contour["pitch"] * wave * emphasis))
            rate_jitter = int(round(contour["rate"] * wave * emphasis))
            part_path = os.path.join(workdir, f"part-{i:04d}.mp3")
            communicate = edge_tts.Communicate(
                chunk_text,
                edge_voice,
                rate=f"{base_rate + rate_jitter:+d}%",
                pitch=f"{pitch_hz:+d}Hz",
            )
            await communicate.save(part_path)
            part_paths.append(part_path)

        concat_list = os.path.join(workdir, "list.txt")
        with open(concat_list, "w") as f:
            for j, part in enumerate(part_paths):
                f.write(f"file '{part}'\n")
                if j < len(part_paths) - 1:
                    f.write(f"file '{silence_path}'\n")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
             "-i", concat_list, "-c", "copy", path],
            check=True, capture_output=True,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return path


def generate_voiceover(
    text: str,
    voice: str,
    output_path: str,
    provider: str = "auto",
    speed: float = 1.0,
    expressiveness: str = "expressive",
) -> str:
    """Synthesize speech. provider: 'auto' (ElevenLabs→edge fallback),
    'elevenlabs' (premium only, errors surface), or 'edge' (free only).
    expressiveness shapes prosody: 'natural' | 'expressive' | 'dramatic'."""
    speed = max(0.8, min(1.5, speed))
    if expressiveness not in VALID_EXPRESSIVENESS:
        expressiveness = "expressive"

    entry = VOICE_CATALOG.get(voice, VOICE_CATALOG["daniel"])

    # Voices without a verified ElevenLabs id are free-engine exclusives —
    # never silently substitute another voice's premium render.
    if provider == "edge" or not entry.get("el"):
        return asyncio.run(_edge(text, voice, output_path, speed, expressiveness))

    if provider == "elevenlabs":
        return _elevenlabs(text, voice, output_path, speed, expressiveness)

    # auto
    try:
        return _elevenlabs(text, voice, output_path, speed, expressiveness)
    except Exception as e:
        logger.warning(f"ElevenLabs failed ({e}), falling back to edge-tts")
        return asyncio.run(_edge(text, voice, output_path, speed, expressiveness))


def probe_sample_rate(path: str) -> int:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=sample_rate",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    return int(result.stdout.strip() or 44100)


def pitch_filter(semitones: float, sample_rate: int) -> str:
    """asetrate raises pitch and shortens the clip; atempo compensates so
    duration (and therefore subtitle sync) is preserved."""
    ratio = 2.0 ** (semitones / 12.0)
    new_sr = max(1, int(round(sample_rate * ratio)))
    return f"asetrate={new_sr},aresample={sample_rate},atempo={1 / ratio:.6f}"


def apply_pitch(src: str, dst: str, semitones: float) -> str:
    """Post-Whisper audio stage: shift pitch while preserving duration.
    Call AFTER transcription so word-synced subtitles match the original."""
    if abs(semitones) < 1e-3:
        return src
    sr = probe_sample_rate(src)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", src,
         "-af", pitch_filter(semitones, sr), "-c:a", "libmp3lame", "-q:a", "2", dst],
        check=True,
    )
    return dst
