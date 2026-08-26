"""Indian Hinglish voices: edge-only catalog entries route correctly."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.tts import VOICE_CATALOG


class TestHinglishVoices:
    def test_catalog_entries_are_edge_native(self):
        for vid in ("prabhat", "neerja"):
            entry = VOICE_CATALOG[vid]
            assert entry["el"] is None
            assert entry["edge"].startswith("en-IN-")

    def test_edge_only_voice_never_hits_premium_engine(self, monkeypatch):
        from services import tts

        async def fake_edge(text, voice, path, *a, **k):
            return path

        def boom(*a, **k):
            raise AssertionError("ElevenLabs must not render an edge-only voice")

        monkeypatch.setattr(tts, "_edge", fake_edge)
        monkeypatch.setattr(tts, "_elevenlabs", boom)
        for provider in ("elevenlabs", "auto", "edge"):
            out = tts.generate_voiceover(
                "TUMHE KYA PROBLEM HAI", "prabhat", "/tmp/x.mp3", provider=provider,
            )
            assert out == "/tmp/x.mp3"

    def test_known_voice_still_routes_to_premium_on_auto(self, monkeypatch):
        from services import tts

        def ok_el(text, voice, path, *a, **k):
            return path

        async def boom(*a, **k):
            raise AssertionError("edge fallback should not fire when EL succeeds")

        monkeypatch.setattr(tts, "_elevenlabs", ok_el)
        monkeypatch.setattr(tts, "_edge", boom)
        out = tts.generate_voiceover("hello", "daniel", "/tmp/y.mp3", provider="auto")
        assert out == "/tmp/y.mp3"


class TestAccentRoster:
    def test_new_accent_ids_unique_and_edge_native(self):
        ids = list(VOICE_CATALOG.keys())
        assert len(ids) == len(set(ids))
        for vid in ("steffan", "michelle", "thomas", "libby", "connor", "emily",
                    "chilemba", "asilia", "abeo", "ezinne", "luke", "leah",
                    "pradeep", "nabanita"):
            entry = VOICE_CATALOG[vid]
            assert entry["el"] is None, vid
            assert entry["edge"], vid

    def test_personality_shapes_edge_prosody(self, monkeypatch):
        from services import tts

        captured = {}

        class FakeCommunicate:
            def __init__(self, text, voice, rate=None, pitch=None):
                captured.update(rate=rate, pitch=pitch)

            async def save(self, path):
                return path

        monkeypatch.setattr(tts.edge_tts, "Communicate", FakeCommunicate)
        tts.generate_voiceover(
            "one line.", "prabhat", "/tmp/p.mp3",
            provider="edge", personality="hype",
        )
        assert captured["rate"].startswith("+")
        assert captured["pitch"] == "+22Hz"

    def test_sanitize_personality(self):
        from routers.jobs import _sanitize_settings

        out = _sanitize_settings({"voice_personality": "HYPE"})
        assert out["voice_personality"] == "none"  # unknown → none
        out = _sanitize_settings({"voice_personality": "calm"})
        assert out["voice_personality"] == "calm"
