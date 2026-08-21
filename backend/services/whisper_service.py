import whisper

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


def words_to_chunks(words: list[dict], chunk_size: int = 3) -> list[dict]:
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


def chunks_to_ass(chunks: list[dict], path: str) -> str:
    """Build an ASS subtitle file with an explicit 1080x1920 play area.

    Plain SRT gets rendered by libass on a default 384x288 canvas, which makes
    large MarginV values push text off-screen. Declaring PlayRes here keeps
    MarginV=680 meaning 'about 65% down the 1920px frame' as intended.
    """
    def ts(t: float) -> str:
        cs = int(t * 100)
        h, cs = divmod(cs, 360_000)
        m, cs = divmod(cs, 6_000)
        s, cs = divmod(cs, 100)
        return f"{h}:{m:02}:{s:02}.{cs:02}"

    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Reel,Arial,130,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,8,3,2,80,80,680,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for c in chunks:
        lines.append(f"Dialogue: 0,{ts(c['start'])},{ts(c['end'])},Reel,,0,0,0,,{c['text']}")
    with open(path, "w") as f:
        f.write(header + "\n".join(lines) + "\n")
    return path
