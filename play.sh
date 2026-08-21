#!/bin/bash
# Subtitle style playground — local TTS only, never touches ElevenLabs quota.
# Usage:  ./play.sh [FONT_SIZE] [MARGIN_V] [SPEED]
#   ./play.sh            → defaults 96 / 680 / 1.1
#   ./play.sh 120        → bigger text
#   ./play.sh 96 500 1.3 → custom margin (lower = lower on screen) + faster voice
set -e
cd "$(dirname "$0")/backend"

SIZE="${1:-96}"
MARGIN="${2:-680}"
SPEED="${3:-1.1}"
mkdir -p /tmp/reelbot

./.venv/bin/python - "$SIZE" "$MARGIN" "$SPEED" <<'EOF'
import sys, subprocess
size, margin, speed = sys.argv[1], sys.argv[2], float(sys.argv[3])

from services.tts import generate_voiceover
from services.whisper_service import transcribe, words_to_chunks, chunks_to_ass

audio = generate_voiceover(
    "This is how your subtitles look with these settings. Nice and chunky, two words at a time.",
    "male", "/tmp/reelbot/pg.mp3", provider="edge", speed=speed,
)
chunks = words_to_chunks(transcribe(audio))
ass_path = chunks_to_ass(chunks, "/tmp/reelbot/pg.ass")

lines = []
for line in open(ass_path):
    if line.startswith("Style: Reel"):
        parts = line.strip().split(",")
        parts[2] = size          # Fontsize
        parts[-2] = margin       # MarginV
        lines.append(",".join(parts) + "\n")
    else:
        lines.append(line)
open(ass_path, "w").writelines(lines)

subprocess.run(["ffmpeg","-y","-v","error","-stream_loop","-1","-t","8",
    "-i","assets/gameplay/stock1_1080x1920.mp4","-i","/tmp/reelbot/pg.mp3",
    "-vf",f"subtitles={ass_path}","-map","0:v","-map","1:a","-t","8",
    "-c:v","libx264","-crf","18","-preset","fast","-r","60",
    "-pix_fmt","yuv420p","/tmp/reelbot/pg.mp4"], check=True)
subprocess.run(["ffmpeg","-y","-v","error","-ss","1.5","-i","/tmp/reelbot/pg.mp4",
    "-frames:v","1","-vf","scale=405:720","/tmp/reelbot/pg.png"], check=True)
print(f"\nsize={size} margin={margin} speed={speed}  chunks:", [c["text"] for c in chunks])
print("clip : open /tmp/reelbot/pg.mp4")
print("still: open /tmp/reelbot/pg.png")
EOF
