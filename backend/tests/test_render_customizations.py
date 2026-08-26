"""Tests for render customizations (captions + title card knobs).

Run from backend/:  .venv/bin/python -m pytest tests/ -v
"""

import os
import shutil
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.jobs import _sanitize_settings
from services.title_card import render as render_card
from services.video import get_duration, render_video
from services.whisper_service import (
    DEFAULT_CAPTION_STYLE,
    caption_style_from_settings,
    chunks_to_ass,
    words_to_chunks,
)

# Legacy hardcoded Style line — defaults must reproduce it byte-for-byte.
LEGACY_STYLE_LINE = (
    "Style: Reel,Arial,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,"
    "-1,0,0,0,100,100,0,0,1,6,3,2,80,80,680,1"
)

CHUNKS = [
    {"text": "SO I QUIT", "start": 0.0, "end": 1.0},
    {"text": "MY JOB", "start": 1.0, "end": 2.0},
]


def _style_line(ass: str) -> str:
    return next(line for line in ass.splitlines() if line.startswith("Style:"))


# ---------------------------------------------------------------- sanitizer


class TestSanitizer:
    def test_defaults_untouched(self):
        out = _sanitize_settings({})
        assert out["caption_font_size"] == 96
        assert out["caption_position"] == "lower"
        assert out["caption_color"] == "white"
        assert out["caption_outline"] == 6
        assert out["caption_words"] == 2
        assert out["captions_enabled"] is True
        assert out["title_enabled"] is True
        assert out["title_position"] == "top"
        assert out["title_scale"] == 100
        assert out["title_badge"] is True

    def test_int_clamps(self):
        out = _sanitize_settings({
            "caption_font_size": 5000,   # -> 140
            "caption_outline": -3,       # -> 0
            "caption_words": "9",        # -> 3
            "title_scale": 10,           # -> 60
        })
        assert out["caption_font_size"] == 140
        assert out["caption_outline"] == 0
        assert out["caption_words"] == 3
        assert out["title_scale"] == 60

    def test_bogus_types_fall_back(self):
        out = _sanitize_settings({
            "caption_font_size": "huge",
            "title_scale": None,
            "caption_words": [1],
        })
        assert out["caption_font_size"] == 96
        assert out["title_scale"] == 100
        assert out["caption_words"] == 2

    def test_enum_fallbacks(self):
        out = _sanitize_settings({
            "caption_position": "MIDDLE",
            "caption_color": "#FF0000",
            "title_position": "left",
            "expressiveness": "ANGRY",
        })
        assert out["caption_position"] == "lower"
        assert out["caption_color"] == "white"
        assert out["title_position"] == "top"
        assert out["expressiveness"] == "expressive"

    def test_injection_never_reaches_ass(self):
        # Only whitelisted enums pass; arbitrary strings are dropped wholesale.
        out = _sanitize_settings({"caption_color": "white,Comic"})
        assert out["caption_color"] == "white"

    def test_bool_coercion(self):
        assert _sanitize_settings({"captions_enabled": False})["captions_enabled"] is False
        assert _sanitize_settings({"captions_enabled": "false"})["captions_enabled"] is False
        assert _sanitize_settings({"title_enabled": "true"})["title_enabled"] is True
        assert _sanitize_settings({"title_badge": 0})["title_badge"] is False

    def test_valid_values_pass_through(self):
        out = _sanitize_settings({
            "caption_font_size": 72,
            "caption_position": "center",
            "caption_color": "yellow",
            "caption_outline": 3,
            "caption_words": 3,
            "title_position": "bottom",
            "title_scale": 130,
        })
        assert out["caption_font_size"] == 72
        assert out["caption_position"] == "center"
        assert out["caption_color"] == "yellow"
        assert out["caption_words"] == 3
        assert out["title_position"] == "bottom"
        assert out["title_scale"] == 130


# --------------------------------------------------------------- ASS output


class TestChunksToAss:
    def test_defaults_byte_match_legacy(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "a.ass")
            chunks_to_ass(CHUNKS, path)
            assert LEGACY_STYLE_LINE in open(path).read()

    def test_style_dict_none_matches_default_constant(self):
        assert DEFAULT_CAPTION_STYLE["fontsize"] == 96
        assert DEFAULT_CAPTION_STYLE["margin_v"] == 680

    @pytest.mark.parametrize("position,margin_v", [
        ("lower", 680), ("center", 860), ("upper", 1180),
    ])
    def test_positions(self, position, margin_v):
        style = caption_style_from_settings({"caption_position": position})
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, f"{position}.ass")
            chunks_to_ass(CHUNKS, path, style=style)
            assert f"80,{margin_v},1" in _style_line(open(path).read())

    @pytest.mark.parametrize("color,primary", [
        ("white", "&H00FFFFFF"), ("yellow", "&H0000E5FF"), ("brand", "&H002A45FF"),
    ])
    def test_colors(self, color, primary):
        style = caption_style_from_settings({"caption_color": color})
        assert style["primary"] == primary
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, f"{color}.ass")
            chunks_to_ass(CHUNKS, path, style=style)
            line = _style_line(open(path).read())
            assert line.count(primary) == 2  # PrimaryColour + SecondaryColour

    def test_fontsize_and_outline_threading(self):
        style = caption_style_from_settings({
            "caption_font_size": 140, "caption_outline": 0,
        })
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "a.ass")
            chunks_to_ass(CHUNKS, path, style=style)
            line = _style_line(open(path).read())
            assert ",140," in line and ",1,0,3,2," in line

    def test_hostile_style_keys_ignored(self):
        # Only templated fields are honored; a rogue fontname key still lands
        # in the dict but the fontname slot is fixed to Arial in the template.
        style = caption_style_from_settings(None)
        style["fontname"] = "Arial,Comic"
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "a.ass")
            chunks_to_ass(CHUNKS, path, style=style)
            assert "Style: Reel,Arial," in open(path).read()


class TestWordsToChunks:
    WORDS = [{"word": w, "start": float(i), "end": float(i) + 0.5}
             for i, w in enumerate(["a", "b", "c", "d", "e"])]

    def test_chunk_sizes(self):
        assert len(words_to_chunks(self.WORDS, chunk_size=1)) == 5
        assert len(words_to_chunks(self.WORDS, chunk_size=2)) == 3
        assert len(words_to_chunks(self.WORDS, chunk_size=3)) == 2

    def test_all_caps_text(self):
        assert words_to_chunks([{"word": "quit", "start": 0, "end": 1}], chunk_size=1)[0]["text"] == "QUIT"


# ------------------------------------------------------------- static captions


class TestStaticCaptions:
    def test_sanitize_mode_and_text(self):
        out = _sanitize_settings({"caption_mode": "STATIC", "caption_text": "  hello world  "})
        assert out["caption_mode"] == "synced"          # unknown → synced
        assert out["caption_text"] == "hello world"
        out = _sanitize_settings({"caption_mode": "static", "caption_text": "x" * 1000})
        assert out["caption_mode"] == "static"
        assert len(out["caption_text"]) == 600
        out = _sanitize_settings({})
        assert out["caption_mode"] == "synced" and out["caption_text"] == ""

    def test_even_chunks_uniform_and_bounded(self):
        from services.whisper_service import even_chunks

        chunks = even_chunks("one two three four five six seven eight nine ten", 10.0, 2)
        assert [c["text"] for c in chunks] == [
            "ONE TWO", "THREE FOUR", "FIVE SIX", "SEVEN EIGHT", "NINE TEN",
        ]
        assert chunks[0]["start"] == 0.0
        assert abs(chunks[-1]["end"] - 10.0) < 0.01
        for a, b in zip(chunks, chunks[1:]):
            assert abs(a["end"] - b["start"]) < 0.01   # contiguous, no gaps

    def test_even_chunks_edge_cases(self):
        from services.whisper_service import even_chunks

        assert even_chunks("", 10.0, 2) == []
        assert even_chunks("hi", 0.0, 2) == []
        assert even_chunks("hi there you", 6.0, 99) == [   # words_per_screen clamps to ≤3
            {"text": "HI THERE YOU", "start": 0.0, "end": 6.0},
        ]

    def test_static_block_single_event_fitted(self):
        import re

        from services.whisper_service import static_block

        text = "wait for it nobody expected this twist ending at all"
        (chunk,) = static_block(text, 12.5, words_per_line=3, base_fontsize=96)
        assert chunk["start"] == 0.0 and chunk["end"] == 12.5
        m = re.match(r"\{\\fs(\d+)\}", chunk["text"])
        assert m
        fs = int(m.group(1))
        lines = chunk["text"].split("\n", 1)[1].split("\n")
        assert all(len(l.split()) <= 3 for l in lines)
        longest = max(len(l) for l in lines)
        assert fs * longest * 0.55 <= 980 + 25      # width budget respected
        assert fs * len(lines) * 1.2 <= 1100 + 25   # height budget respected

    def test_static_block_empty(self):
        from services.whisper_service import static_block

        assert static_block("", 10.0, 3) == []

    def test_sanitize_caption_layout(self):
        out = _sanitize_settings({"caption_layout": "BLOCK"})
        assert out["caption_layout"] == "chunks"    # unknown → chunks
        out = _sanitize_settings({"caption_layout": "block"})
        assert out["caption_layout"] == "block"
        out = _sanitize_settings({})
        assert out["caption_layout"] == "chunks"


# ---------------------------------------------------------------- title card


class TestTitleCard:
    LONG_TITLE = ("This is an extremely long title that will definitely wrap past "
                  "four lines and therefore needs truncation logic to kick in properly")

    @pytest.mark.parametrize("pct,w,h", [(60, 600, 204), (100, 1000, 340), (130, 1300, 442)])
    def test_scale_dimensions(self, pct, w, h):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, f"c{pct}.png")
            render_card("Hello world", "AskReddit", "dark", path, scale_pct=pct)
            from PIL import Image
            assert Image.open(path).size == (w, h)

    def test_out_of_range_scale_clamped(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "c.png")
            render_card("Hi", "x", "dark", path, scale_pct=9999)
            from PIL import Image
            assert Image.open(path).size == (1300, 442)

    @pytest.mark.parametrize("badge", [True, False])
    def test_badge_toggle_and_styles(self, badge):
        for st in ("dark", "light", "minimal"):
            with tempfile.TemporaryDirectory() as d:
                path = os.path.join(d, f"{st}.png")
                assert render_card("T", "AskReddit", st, path, show_badge=badge) == path

    def test_long_title_truncates_without_error(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "long.png")
            render_card(self.LONG_TITLE, "AskReddit", "dark", path, scale_pct=60)
            from PIL import Image
            Image.open(path).verify()

    def test_empty_subreddit_with_badge_disabled(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "nb.png")
            render_card("T", "", "minimal", path, show_badge=False)


# ------------------------------------------------------------ ffmpeg matrix


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
class TestRenderMatrix:
    """Corner-case renders: every layer on/off x extreme positions."""

    D = 0.5  # seconds

    @pytest.fixture(scope="module")
    def media(self, tmp_path_factory):
        base = tmp_path_factory.mktemp("matrix")
        clip = str(base / "bg.mp4")
        audio = str(base / "silence.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
             "-i", f"testsrc=size=1080x1920:rate=30:duration={self.D}",
             "-c:v", "libx264", "-preset", "ultrafast", clip],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
             "-i", f"anullsrc=r=24000:cl=mono", "-t", str(self.D), audio],
            check=True, capture_output=True,
        )
        subs = []
        for name, pos, color, size, outline in [
            ("lower-white-min", {}, {}, {}, {}),
            ("upper-yellow-max", {"caption_position": "upper"}, {"caption_color": "yellow"},
             {"caption_font_size": 140}, {}),
            ("center-brand-nooutline", {"caption_position": "center"}, {"caption_color": "brand"},
             {}, {"caption_outline": 0}),
        ]:
            p = base / f"{name}.ass"
            chunks_to_ass(
                CHUNKS, str(p),
                style=caption_style_from_settings({**pos, **color, **size, **outline}),
            )
            subs.append(str(p))
        cards = {}
        for name, kwargs in {
            "top-max": dict(scale_pct=130),
            "bottom-min-nobadge": dict(scale_pct=60, show_badge=False),
        }.items():
            p = base / f"{name}.png"
            render_card("AITA for returning my roommate's vacuum?", "AskReddit", "dark", str(p), **kwargs)
            cards[name] = str(p)
        return {"clip": clip, "audio": audio, "subs": subs, "cards": cards, "out": str(base)}

    def _render(self, m, out_name, *, card=None, subs=None, card_pos="top"):
        out = os.path.join(m["out"], f"{out_name}.mp4")
        render_video(m["clip"], m["audio"], out, card=card, subs=subs, card_pos=card_pos)
        dur = get_duration(out)
        assert self.D * 0.5 <= dur <= self.D + 1.5

    def test_full_stack_top_max_card(self, media):
        self._render(media, "full-top", card=media["cards"]["top-max"], subs=media["subs"][0])

    def test_bottom_min_card_no_badge_upper_captions(self, media):
        self._render(media, "bottom-corner",
                     card=media["cards"]["bottom-min-nobadge"],
                     subs=media["subs"][1], card_pos="bottom")

    def test_subs_only_no_card(self, media):
        self._render(media, "subs-only", subs=media["subs"][2])

    def test_card_only_no_subs(self, media):
        self._render(media, "card-only", card=media["cards"]["top-max"])

    def test_neither_layer(self, media):
        self._render(media, "bare")
