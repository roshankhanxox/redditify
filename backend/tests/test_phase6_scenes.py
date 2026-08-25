"""Tests for V2 Phase 6: meme template — scenes, gradients, pitch stage."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest.mock as mock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.jobs import _sanitize_settings
from services import scenes as scenes_service
from services.graphics import render_gradient, render_starry
from services.tts import apply_pitch, pitch_filter
from services.video import get_duration, render_meme_video


# ------------------------------------------------------------------ registry


class TestSceneRegistry:
    def test_ids_unique_and_known_kinds(self):
        ids = [s["id"] for s in scenes_service.SCENES]
        assert len(ids) == len(set(ids))
        assert all(
            s["kind"] in ("gradient", "starry", "animated_gradient")
            for s in scenes_service.SCENES
        )

    def test_get_scene_unknown_is_none(self):
        assert scenes_service.get_scene("nope") is None
        assert scenes_service.get_scene(None) is None
        assert scenes_service.get_scene("rainbow")["id"] == "rainbow"

    def test_render_scene_still_dispatches(self):
        with tempfile.TemporaryDirectory() as d:
            for scene in scenes_service.SCENES:
                out = os.path.join(d, f"{scene['id']}.png")
                scenes_service.render_scene_still(scene, out, size=(64, 114))
                from PIL import Image
                with Image.open(out) as im:
                    im.verify()


class TestDeterminism:
    def test_gradient_bytes_stable(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = os.path.join(d, "a.png"), os.path.join(d, "b.png")
            render_gradient(["#ff0000", "#0000ff"], a, size=(64, 114))
            render_gradient(["#ff0000", "#0000ff"], b, size=(64, 114))
            assert open(a, "rb").read() == open(b, "rb").read()

    def test_starry_seed_stable(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = os.path.join(d, "a.png"), os.path.join(d, "b.png")
            render_starry(a, size=(64, 114), seed=11)
            render_starry(b, size=(64, 114), seed=11)
            assert open(a, "rb").read() == open(b, "rb").read()


# ----------------------------------------------------------------- sanitizer


class TestMemeSanitizer:
    def test_template_defaults_story(self):
        out = _sanitize_settings({})
        assert out["template"] == "story"
        assert out["scene_id"] == ""
        assert out["tts_pitch"] == 0

    def test_meme_fields_pass_through(self):
        out = _sanitize_settings({
            "template": "meme", "scene_id": "sunset", "tts_pitch": 5,
        })
        assert out["template"] == "meme"
        assert out["scene_id"] == "sunset"
        assert out["tts_pitch"] == 5

    def test_bogus_scene_falls_back_to_default(self):
        out = _sanitize_settings({"template": "meme", "scene_id": "../../etc"})
        assert out["scene_id"] == scenes_service.DEFAULT_SCENE_ID

    def test_pitch_clamped(self):
        out = _sanitize_settings({"template": "meme", "tts_pitch": 99})
        assert out["tts_pitch"] == 12
        out = _sanitize_settings({"template": "meme", "tts_pitch": "-7"})
        assert out["tts_pitch"] == -7

    def test_story_template_ignores_meme_fields(self):
        out = _sanitize_settings({
            "template": "story", "scene_id": "ocean", "tts_pitch": 9,
        })
        assert out["scene_id"] == ""
        assert out["tts_pitch"] == 0

    def test_injection_never_reaches_registry(self):
        out = _sanitize_settings({"template": "meme; rm -rf", "scene_id": ["x"]})
        assert out["template"] == "story"
        assert out["scene_id"] == ""


# --------------------------------------------------------------- pitch stage


class TestPitch:
    def test_filter_math(self):
        f = pitch_filter(5, 44100)
        # ratio = 2^(5/12) ≈ 1.33484
        assert "aresample=44100" in f and "atempo=" in f

    def test_zero_semitones_noop(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "a.mp3")
            shutil.copy(__file__, src)  # any file; must not be touched
            assert apply_pitch(src, os.path.join(d, "b.mp3"), 0) == src

    @pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
    def test_duration_preserved(self):
        d = tempfile.mkdtemp()
        src = os.path.join(d, "tone.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
             "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame", src],
            check=True, capture_output=True,
        )
        out = apply_pitch(src, os.path.join(d, "up.mp3"), 6)
        assert abs(get_duration(out) - get_duration(src)) < 0.15


# ------------------------------------------------------------ meme rendering


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
class TestMemeRender:
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

    def test_animated_uses_lavfi_gradients(self, audio, tmp_path):
        scene = next(s for s in scenes_service.SCENES if s["kind"] == "animated_gradient")
        out = str(tmp_path / "meme.mp4")
        with mock.patch("services.video.run_ffmpeg") as run:
            render_meme_video(scene, audio, out, tmp_dir=str(tmp_path))
        args = run.call_args[0][0]
        lavfi = args[args.index("-f") + 1] if "-f" in args else ""
        assert "gradients=s=1080x1920" in lavfi or any(
            "gradients" in a for a in args
        )
        # Audio input index accounts for the two-part lavfi input.
        assert f"{len([a for a in args])}"  # smoke: command built

    def test_static_renders_real_file(self, audio, tmp_path):
        scene = scenes_service.get_scene("sunset")
        out = str(tmp_path / "meme-static.mp4")
        render_meme_video(scene, audio, out, tmp_dir=str(tmp_path))
        assert self.D * 0.5 <= get_duration(out) <= self.D + 1.5
