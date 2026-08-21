import asyncio
import logging

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


def _elevenlabs(text: str, voice: str, path: str, speed: float = 1.0) -> str:
    client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
    voice_id = VOICE_CATALOG.get(voice, {}).get("el") or VOICE_CATALOG["male"]["el"]
    audio = client.text_to_speech.convert(
        voice_id=voice_id,
        model_id="eleven_multilingual_v2",
        text=text,
        voice_settings={
            "stability": 0.4,
            "similarity_boost": 0.85,
            "style": 0.3,
            "speed": max(0.7, min(1.2, speed)),
        },
    )
    with open(path, "wb") as f:
        for chunk in audio:
            f.write(chunk)
    return path


async def _edge(text: str, voice: str, path: str, speed: float = 1.0) -> str:
    edge_voice = VOICE_CATALOG.get(voice, {}).get("edge") or VOICE_CATALOG["male"]["edge"]
    rate_pct = int(round((speed - 1.0) * 100))
    communicate = edge_tts.Communicate(text, edge_voice, rate=f"{rate_pct:+d}%")
    await communicate.save(path)
    return path


def generate_voiceover(
    text: str,
    voice: str,
    output_path: str,
    provider: str = "auto",
    speed: float = 1.0,
) -> str:
    """Synthesize speech. provider: 'auto' (ElevenLabs→edge fallback),
    'elevenlabs' (premium only, errors surface), or 'edge' (free only)."""
    speed = max(0.8, min(1.5, speed))

    if provider == "edge":
        return asyncio.run(_edge(text, voice, output_path, speed))

    if provider == "elevenlabs":
        return _elevenlabs(text, voice, output_path, speed)

    # auto
    try:
        return _elevenlabs(text, voice, output_path, speed)
    except Exception as e:
        logger.warning(f"ElevenLabs failed ({e}), falling back to edge-tts")
        return asyncio.run(_edge(text, voice, output_path, speed))
