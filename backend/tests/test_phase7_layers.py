"""Tests for V2 Phase 7a: characters, text overlays, layer sanitizer."""

import os
import shutil
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.jobs import _sanitize_settings
from services import scenes as scenes_service
from services.fonts import get_font_path, list_fonts
from services.text_overlay import render_text_overlay
from services.video import get_duration, render_meme_video


# ------------------------------------------------------------------ fonts


class TestFontRegistry:
    def test_registry_nonempty_and_whitelisted(self):
        fonts = list_fonts()
        assert len(fonts) >= 2
        assert get_font_path(fonts[0]["id"]) is not None
        # Path traversal can never resolve.
        assert get_font_path("../../secrets") is None
        assert get_font_path("Anton-Regular.ttf") is None  # raw filename ≠ id


# ------------------------------------------------------------- text overlay


class TestTextOverlay:
    def test_deterministic(self):
        spec = {"text": "POV:", "font_id": "anton", "size": 120,
                "color": "#ffffff", "align": "center"}
        with tempfile.TemporaryDirectory() as d:
            a = render_text_overlay(spec, os.path.join(d, "a.png"))
            b = render_text_overlay(spec, os.path.join(d, "b.png"))
            assert open(a, "rb").read() == open(b, "rb").read()

    def test_width_fit_shrinks(self):
        long_line = "THIS LINE IS ABSURDLY LONG AND MUST SHRINK TO FIT THE FRAME"
        out = render_text_overlay({
            "text": long_line, "font_id": "anton", "size": 220,
            "color": "#ffffff", "align": "center",
        })
        from PIL import Image
        w, _ = Image.open(out).size
        # Overlay canvas (incl. padding) must stay inside the 1080 frame.
        assert w <= 1080

    def test_multiline_explicit_breaks(self):
        out = render_text_overlay({
            "text": "LINE ONE\nLINE TWO", "font_id": "bebasneue", "size": 96,
            "color": "#ffe500", "align": "left",
        })
        from PIL import Image
        im = Image.open(out)
        assert im.mode == "RGBA"
        assert im.height > im.width / 3  # two stacked lines are tall-ish

    def test_unknown_font_rejected_at_sanitizer_level(self):
        out = _sanitize_settings({
            "template": "meme",
            "text_overlays": [{"text": "hi", "font_id": "../../etc/passwd"}],
        })
        assert out["text_overlays"] == []


# ----------------------------------------------------------------- sanitizer


class TestLayerSanitizer:
    BASE = {"template": "meme", "scene_id": "sunset"}

    def test_character_clamps_and_defaults(self):
        out = _sanitize_settings({**self.BASE, "characters": [{
            "asset_id": "11111111-1111-1111-1111-111111111111",
            "x": 5.0, "y": -3, "scale": 42, "flip": 1, "bob": "true",
        }]})
        (c,) = out["characters"]
        assert c["x"] == 1.0 and c["y"] == 0.0 and c["scale"] == 0.9
        assert c["flip"] is True and c["bob"] is True

    def test_bad_asset_ids_dropped(self):
        out = _sanitize_settings({**self.BASE, "characters": [
            {"asset_id": "11111111-1111-1111-1111-111111111111"},
            {"asset_id": "not-a-uuid"},
            {"asset_id": "../../etc/passwd"},
            {"asset_id": "44444444-4444-4444-4444-444444444444"},  # beyond cap
        ]})
        # [:3] cap applies BEFORE validation: 4th entry never considered.
        assert len(out["characters"]) == 1
        assert out["characters"][0]["asset_id"].endswith("1111")

    def test_cap_three_layers(self):
        good = {"asset_id": "22222222-2222-2222-2222-222222222222"}
        out = _sanitize_settings({**self.BASE, "characters": [good] * 9})
        assert len(out["characters"]) == 3

    def test_text_color_whitelist(self):
        out = _sanitize_settings({**self.BASE, "text_overlays": [
            {"text": "ok", "font_id": "anton", "color": "#FF00aa"},
            {"text": "bad", "font_id": "anton", "color": "red;drop table"},
            {"text": "   ", "font_id": "anton"},          # blank dropped
            {"text": "nofont"},                            # unknown font dropped
        ]})
        # Valid + bad-color-defaulted kept; blank and unknown-font dropped;
        # entries beyond the 3-cap never considered ("nofont").
        assert len(out["text_overlays"]) == 2
        assert [t["color"] for t in out["text_overlays"]] == ["#ff00aa", "#ffffff"]
        assert out["text_overlays"][0]["font_id"] == "anton"

    def test_story_template_strips_layers(self):
        out = _sanitize_settings({
            "template": "story",
            "characters": [{"asset_id": "33333333-3333-3333-3333-333333333333"}],
            "text_overlays": [{"text": "x", "font_id": "anton"}],
        })
        assert out["characters"] == [] and out["text_overlays"] == []


# ---------------------------------------------------------------- rendering


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
class TestMemeLayeredRender:
    D = 0.8

    @pytest.fixture()
    def audio(self, tmp_path):
        p = str(tmp_path / "silence.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
             "-i", "anullsrc=r=24000:cl=mono", "-t", str(self.D), p],
            check=True, capture_output=True,
        )
        return p

    @pytest.fixture()
    def character_png(self, tmp_path):
        """RGBA cutout-style disc."""
        from PIL import Image, ImageDraw

        p = str(tmp_path / "cutout.png")
        img = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((20, 20, 380, 380), fill=(255, 120, 40, 255))
        img.save(p, "PNG")
        return p

    def test_full_stack_scene_char_text(self, audio, character_png, tmp_path):
        scene = scenes_service.get_scene("candy")
        text_png = render_text_overlay({
            "text": "NOBODY:", "font_id": "anton", "size": 140,
            "color": "#ffffff", "align": "center",
        }, str(tmp_path / "t.png"))
        out = str(tmp_path / "meme-full.mp4")

        render_meme_video(
            scene, audio, out,
            tmp_dir=str(tmp_path),
            characters=[{"path": character_png, "x": 0.5, "y": 0.62,
                         "scale": 0.4, "flip": False, "bob": True}],
            text_pngs=[{"path": text_png, "x": 0.5, "y": 0.18}],
        )
        assert self.D * 0.5 <= get_duration(out) <= self.D + 1.5

    def test_flip_variant_renders(self, audio, character_png, tmp_path):
        scene = scenes_service.get_scene("ocean")
        out = str(tmp_path / "meme-flip.mp4")
        render_meme_video(
            scene, audio, out,
            tmp_dir=str(tmp_path),
            characters=[{"path": character_png, "x": 0.25, "y": 0.5,
                         "scale": 0.2, "flip": True, "bob": False}],
        )
        assert os.path.exists(out)
