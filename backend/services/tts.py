import asyncio
import logging

import edge_tts
from elevenlabs import ElevenLabs

from config import settings

logger = logging.getLogger(__name__)

ELEVENLABS_VOICES = {
    "male": "onwK4e9ZLuTAKqWW03F9",
    "female": "EXAVITQu4vr4xnSDxMaL",
    "neutral": "21m00Tcm4TlvDq8ikWAM",
}

EDGE_VOICES = {
    "male": "en-US-GuyNeural",
    "female": "en-US-JennyNeural",
    "neutral": "en-US-AriaNeural",
}


def _elevenlabs(text: str, voice: str, path: str) -> str:
    client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
    audio = client.text_to_speech.convert(
        voice_id=ELEVENLABS_VOICES[voice],
        model_id="eleven_multilingual_v2",
        text=text,
        voice_settings={"stability": 0.4, "similarity_boost": 0.85, "style": 0.3},
    )
    with open(path, "wb") as f:
        for chunk in audio:
            f.write(chunk)
    return path


async def _edge(text: str, voice: str, path: str) -> str:
    communicate = edge_tts.Communicate(text, EDGE_VOICES[voice])
    await communicate.save(path)
    return path


def generate_voiceover(text: str, voice: str, output_path: str) -> str:
    """Try ElevenLabs first, silently fall back to edge-tts on any failure."""
    try:
        return _elevenlabs(text, voice, output_path)
    except Exception as e:
        logger.warning(f"ElevenLabs failed ({e}), falling back to edge-tts")
        return asyncio.run(_edge(text, voice, output_path))
