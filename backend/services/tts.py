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

# Curated voice catalog — every entry works on both providers (with an
# equivalent-sounding fallback mapping for the free engine).
VOICE_CATALOG: dict[str, dict] = {
    "male":       {"label": "Daniel · Deep Storyteller", "el": "onwK4e9ZLuTAKqWW03F9", "edge": "en-US-GuyNeural"},
    "adam":       {"label": "Adam · Warm Narrator",      "el": "pNInz6obpgDQGcFmaJgB", "edge": "en-US-ChristopherNeural"},
    "josh":       {"label": "Josh · Energetic Male",     "el": "TxGEqnHWrfWFTfGW9XjX", "edge": "en-US-EricNeural"},
    "brian":      {"label": "Brian · Casual Male",       "el": "nPczCjzI2devNBz1zQrb", "edge": "en-US-BrianNeural"},
    "female":     {"label": "Sarah · Friendly Female",   "el": "EXAVITQu4vr4xnSDxMaL", "edge": "en-US-JennyNeural"},
    "rachel":     {"label": "Rachel · Calm Female",      "el": "21m00Tcm4TlvDq8ikWAM", "edge": "en-US-AriaNeural"},
    "emily":      {"label": "Emily · Bright Female",     "el": "LcfcDJNUP1GQjkzn1xUU", "edge": "en-US-MichelleNeural"},
    "charlotte":  {"label": "Charlotte · Posh Female",   "el": "XB0fDUnXU5powFXDhCwa", "edge": "en-US-AvaNeural"},
    "george":     {"label": "George · British Narrator", "el": "JBFqnCBsd6RMkjVDRZzb", "edge": "en-GB-RyanNeural"},
    "gigi":       {"label": "Gigi · Sassy Female",       "el": "jBpfuIE2acCO8z3wKNLl", "edge": "en-GB-SoniaNeural"},
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
    voice_id = VOICE_CATALOG.get(voice, {}).get("el") or VOICE_CATALOG["male"]["el"]
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
    edge_voice = VOICE_CATALOG.get(voice, {}).get("edge") or VOICE_CATALOG["male"]["edge"]
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

    if provider == "edge":
        return asyncio.run(_edge(text, voice, output_path, speed, expressiveness))

    if provider == "elevenlabs":
        return _elevenlabs(text, voice, output_path, speed, expressiveness)

    # auto
    try:
        return _elevenlabs(text, voice, output_path, speed, expressiveness)
    except Exception as e:
        logger.warning(f"ElevenLabs failed ({e}), falling back to edge-tts")
        return asyncio.run(_edge(text, voice, output_path, speed, expressiveness))
