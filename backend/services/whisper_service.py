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


def words_to_chunks(words: list[dict], chunk_size: int = 4) -> list[dict]:
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
