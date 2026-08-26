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
