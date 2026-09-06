import whisper

# PlayRes is 1080x1920 (declared in chunks_to_ass); MarginV values below land
# the caption block ~65% / center / upper-third down the frame.
CAPTION_POSITION_MARGIN_V = {"lower": 680, "center": 860, "upper": 1180}

# ASS PrimaryColour is &H00BBGGRR. yellow = ffmpeg gold, brand = Reddit orange.
CAPTION_COLOR_PRIMARY = {
    "white": "&H00FFFFFF",
    "yellow": "&H0000E5FF",
    "brand": "&H002A45FF",
}

# Maps the user's caption_highlight_color choice to the ASS colour used for the
# active (highlighted) word. Uses the same &H00BBGGRR encoding as CAPTION_COLOR_PRIMARY.
CAPTION_HIGHLIGHT_COLORS = CAPTION_COLOR_PRIMARY  # same palette, separate semantic

DEFAULT_CAPTION_STYLE = {
    "fontname": "Arial",
    "fontsize": 96,
    "primary": CAPTION_COLOR_PRIMARY["white"],
    "outline_colour": "&H00000000",
    "outline": 6,
    "shadow": 3,
    "alignment": 2,
    "margin_v": CAPTION_POSITION_MARGIN_V["lower"],
}


def caption_style_from_settings(cfg: dict | None) -> dict:
    """Resolve sanitized job settings into a full ASS style dict.

    Re-clamps defensively so callers that bypass the API sanitizer (scripts,
    manual scratch resumes) still produce safe numeric/enum values.
    """
    cfg = cfg or {}
    try:
        fontsize = max(48, min(140, int(cfg.get("caption_font_size", DEFAULT_CAPTION_STYLE["fontsize"]))))
    except (TypeError, ValueError):
        fontsize = DEFAULT_CAPTION_STYLE["fontsize"]
    try:
        outline = max(0, min(12, int(cfg.get("caption_outline", DEFAULT_CAPTION_STYLE["outline"]))))
    except (TypeError, ValueError):
        outline = DEFAULT_CAPTION_STYLE["outline"]
    margin_v = CAPTION_POSITION_MARGIN_V.get(
        cfg.get("caption_position"), DEFAULT_CAPTION_STYLE["margin_v"]
    )
    # Free-drag placement wins over the position preset when present.
    # caption_y is the block center as a frame-height fraction; alignment=2
    # anchors the block bottom at H - MarginV, so invert through 1920px.
    try:
        caption_y = float(cfg.get("caption_y"))
    except (TypeError, ValueError):
        caption_y = None
    if caption_y is not None and 0.02 <= caption_y <= 0.98:
        margin_v = max(40, min(1880, int(round((1 - caption_y) * 1920))))
    return {
        **DEFAULT_CAPTION_STYLE,
        "fontsize": fontsize,
        "outline": outline,
        "margin_v": margin_v,
        "primary": CAPTION_COLOR_PRIMARY.get(
            cfg.get("caption_color"), DEFAULT_CAPTION_STYLE["primary"]
        ),
    }


_model = None  # Singleton — loaded once per worker process


def get_model():
    global _model
    if _model is None:
        _model = whisper.load_model("base")
    return _model


def transcribe(audio_path: str) -> list[dict]:
    result = get_model().transcribe(audio_path, word_timestamps=True, language="en")
    words = []
    for seg in result["segments"]:
        for w in seg.get("words", []):
            words.append({"word": w["word"].strip(), "start": w["start"], "end": w["end"]})
    return words


def words_to_chunks(words: list[dict], chunk_size: int = 2) -> list[dict]:
    chunks = []
    for i in range(0, len(words), chunk_size):
        group = words[i : i + chunk_size]
        chunks.append({
            "text": " ".join(w["word"] for w in group).upper(),
            "start": group[0]["start"],
            "end": group[-1]["end"] + 0.1,
        })
    return chunks


def even_chunks(text: str, duration: float, words_per_screen: int = 2) -> list[dict]:
    """Static-caption timing: split user text into word groups shown for equal
    slices of the voiceover duration. No transcription — pacing is uniform,
    which is exactly the trade static captions opt into."""
    words = text.split()
    if not words or duration <= 0:
        return []
    size = max(1, min(3, int(words_per_screen)))
    groups = [" ".join(words[i : i + size]) for i in range(0, len(words), size)]
    step = duration / len(groups)
    return [
        {"text": g.upper(), "start": round(i * step, 3), "end": round((i + 1) * step, 3)}
        for i, g in enumerate(groups)
    ]


# Static-caption block rendering (fit-to-box wrap, emoji support) lives in
# services/caption_png.py — libass can't do color emojis, so static text is
# composited as PNG overlays instead of burned ASS events.


def chunks_to_srt(chunks: list[dict], path: str) -> str:
    def ts(t: float) -> str:
        ms = int(t * 1000)
        h, ms = divmod(ms, 3_600_000)
        m, ms = divmod(ms, 60_000)
        s, ms = divmod(ms, 1_000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"

    content = ""
    for i, c in enumerate(chunks, 1):
        content += f"{i}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n\n"
    with open(path, "w") as f:
        f.write(content)
    return path


def _ass_inline_color(ass_color: str) -> str:
    """Convert ASS &H00BBGGRR style colour to inline override &HBBGGRR& form."""
    # ass_color is "&H00BBGGRR" (8 hex chars after &H), strip leading 00 alpha.
    hex_part = ass_color.lstrip("&H").lstrip("&h")
    # Take the last 6 chars (BBGGRR, drop the 00 alpha prefix)
    return "&H" + hex_part[-6:] + "&"


def words_to_karaoke_ass(
    words: list[dict],
    path: str,
    style: dict | None = None,
    chunk_size: int = 2,
    highlight: str = "yellow",
) -> str | None:
    """Write a karaoke ASS file where each spoken word highlights in turn.

    Emits N contiguous, non-overlapping Dialogue events per N-word chunk.
    Event k shows the entire chunk with word k in the highlight colour + a
    150ms scale pop; all other words appear in the base colour.

    Returns path on success, None if words is empty.
    """
    if not words:
        return None

    def ts(t: float) -> str:
        cs = int(t * 100)
        h, cs = divmod(cs, 360_000)
        m, cs = divmod(cs, 6_000)
        s, cs = divmod(cs, 100)
        return f"{h}:{m:02}:{s:02}.{cs:02}"

    s = {**DEFAULT_CAPTION_STYLE, **(style or {})}
    # Inactive words are always white so the highlight colour pops regardless of
    # what caption_color the user chose (yellow-on-yellow would be invisible).
    base_inline = _ass_inline_color(CAPTION_COLOR_PRIMARY["white"])
    hl_color    = CAPTION_HIGHLIGHT_COLORS.get(highlight, CAPTION_HIGHLIGHT_COLORS["yellow"])
    hl_inline   = _ass_inline_color(hl_color)

    style_line = (
        f"Style: Reel,{s['fontname']},{int(s['fontsize'])},"
        f"{s['primary']},{s['primary']},{s['outline_colour']},&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,{int(s['outline'])},{int(s['shadow'])},"
        f"{int(s['alignment'])},80,80,{int(s['margin_v'])},1"
    )

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{style_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def _escape(text: str) -> str:
        return text.replace("{", "(").replace("}", ")").replace("\n", " ")

    lines = []
    size = max(1, min(3, chunk_size))
    for i in range(0, len(words), size):
        group = words[i : i + size]
        n = len(group)
        chunk_end = group[-1]["end"] + 0.1

        for k in range(n):
            ev_start = group[k]["start"]
            ev_end   = group[k + 1]["start"] if k < n - 1 else chunk_end
            if ev_end <= ev_start:
                ev_end = ev_start + 0.05

            parts = []
            for j, w in enumerate(group):
                text = _escape(w["word"].strip()).upper()
                if j == k:
                    # Active word: highlight colour + 15% scale pop that settles to 100% in 150ms
                    parts.append(
                        r"{\c" + hl_inline + r"\fscx115\fscy115\t(0,150,\fscx100\fscy100)}" + text
                    )
                else:
                    parts.append(r"{\c" + base_inline + r"\fscx100\fscy100}" + text)

            line_text = " ".join(parts)
            lines.append(f"Dialogue: 0,{ts(ev_start)},{ts(ev_end)},Reel,,0,0,0,,{line_text}")

    with open(path, "w") as f:
        f.write(header + "\n".join(lines) + "\n")
    return path


def chunks_to_ass(chunks: list[dict], path: str, style: dict | None = None) -> str:
    """Build an ASS subtitle file with an explicit 1080x1920 play area.

    Plain SRT gets rendered by libass on a default 384x288 canvas, which makes
    large MarginV values push text off-screen. Declaring PlayRes here keeps
    MarginV=680 meaning 'about 65% down the 1920px frame' as intended.

    `style` is an optional partial dict merged over DEFAULT_CAPTION_STYLE; only
    the templated fields below are honored, so arbitrary keys (e.g. a hostile
    fontname) can never reach the Style line.
    """
    def ts(t: float) -> str:
        cs = int(t * 100)
        h, cs = divmod(cs, 360_000)
        m, cs = divmod(cs, 6_000)
        s, cs = divmod(cs, 100)
        return f"{h}:{m:02}:{s:02}.{cs:02}"

    s = {**DEFAULT_CAPTION_STYLE, **(style or {})}
    style_line = (
        f"Style: Reel,{s['fontname']},{int(s['fontsize'])},"
        f"{s['primary']},{s['primary']},{s['outline_colour']},&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,{int(s['outline'])},{int(s['shadow'])},"
        f"{int(s['alignment'])},80,80,{int(s['margin_v'])},1"
    )

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{style_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for c in chunks:
        lines.append(f"Dialogue: 0,{ts(c['start'])},{ts(c['end'])},Reel,,0,0,0,,{c['text']}")
    with open(path, "w") as f:
        f.write(header + "\n".join(lines) + "\n")
    return path
