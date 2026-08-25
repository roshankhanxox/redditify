"""Tests for V2 Phase 2: thumbnails + stats plumbing."""

import os
import shutil
import subprocess
import sys
import tempfile
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.jobs import job_to_dict, thumbnail_key_for
from services.video import extract_thumbnail, get_duration


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def _make_clip(directory: str) -> str:
    src = os.path.join(directory, "reel.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", "testsrc=size=1080x1920:rate=30:duration=3",
         "-c:v", "libx264", "-preset", "ultrafast", src],
        check=True, capture_output=True,
    )
    return src


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
class TestExtractThumbnail:
    def _clip(self, tmp_path) -> str:
        return _make_clip(str(tmp_path))

    def _size(self, path):
        from PIL import Image
        with Image.open(path) as im:
            im.verify()
        return Image.open(path).size

    def test_produces_270x480_jpg(self, tmp_path):
        dst = str(tmp_path / "thumb.jpg")
        extract_thumbnail(self._clip(tmp_path), dst, at_seconds=1.0)
        assert os.path.exists(dst)
        assert self._size(dst) == (270, 480)

    def test_short_clip_fractional_seek(self, tmp_path):
        # at_seconds below 1s must still land a frame (short reels).
        dst = str(tmp_path / "thumb-short.jpg")
        extract_thumbnail(self._clip(tmp_path), dst, at_seconds=0.1)
        assert self._size(dst) == (270, 480)

    def test_negative_seek_clamped(self, tmp_path):
        dst = str(tmp_path / "thumb-neg.jpg")
        extract_thumbnail(self._clip(tmp_path), dst, at_seconds=-5)
        assert os.path.exists(dst)


class TestThumbnailKeyAndPayload:
    uid, jid = uuid.uuid4(), uuid.uuid4()

    def _job(self, status="DONE", result_url="users/u/reels/r.mp4"):
        from models import Job

        return Job(
            id=self.jid, user_id=self.uid, post_title="T", post_body="B",
            status=status, result_url=result_url,
        )

    def test_key_format(self):
        assert thumbnail_key_for(self._job()) == f"users/{self.uid}/thumbs/{self.jid}.jpg"

    def test_local_mode_thumb_url(self, monkeypatch):
        monkeypatch.setattr("routers.jobs.settings.STORAGE_BACKEND", "local")
        d = job_to_dict(self._job())
        assert d["thumbnail_url"] == f"/jobs/{self.jid}/thumbnail"

    def test_s3_mode_presigned(self, monkeypatch):
        monkeypatch.setattr("routers.jobs.settings.STORAGE_BACKEND", "s3")
        monkeypatch.setattr(
            "routers.jobs.presign_get", lambda k, ttl, filename=None: "https://signed"
        )
        d = job_to_dict(self._job())
        assert d["thumbnail_url"] == "https://signed"

    def test_no_thumb_when_not_done_or_missing_result(self, monkeypatch):
        monkeypatch.setattr("routers.jobs.settings.STORAGE_BACKEND", "local")
        assert job_to_dict(self._job(status="UPLOADING"))["thumbnail_url"] is None
        assert job_to_dict(self._job(result_url=None))["thumbnail_url"] is None


def test_stats_router_imports():
    # Import-time guard: bad SQL/imports in the endpoint surface here.
    from routers import stats  # noqa: F401
