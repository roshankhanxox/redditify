import os
import shutil
import tempfile
import threading

from config import settings


def _root() -> str:
    return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", settings.LOCAL_STORAGE_PATH))


# --- S3 client (lazy singleton; sync so it is safe for API threads and Celery) ---

_client = None
_client_lock = threading.Lock()


def _s3():
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                import boto3
                from botocore.config import Config

                kwargs = {"region_name": settings.S3_REGION}
                if settings.S3_ENDPOINT_URL:
                    # MinIO and other S3-compatible stores need path-style
                    # addressing and explicit SigV4 — otherwise botocore falls
                    # back to SigV2 query auth, which breaks presigned uploads
                    # whenever the browser sends a Content-Type header.
                    kwargs["endpoint_url"] = settings.S3_ENDPOINT_URL
                    kwargs["config"] = Config(
                        s3={"addressing_style": "path"},
                        signature_version="s3v4",
                    )
                if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
                    kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
                    kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
                _client = boto3.client("s3", **kwargs)
    return _client


def is_s3() -> bool:
    return settings.STORAGE_BACKEND == "s3"


def _cache_path(key: str) -> str:
    safe = os.path.normpath(key).lstrip("./")
    path = os.path.join(tempfile.gettempdir(), "reelbot-cache", safe)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


# --- Core adapter (same signatures as the original local-only module) ---


def upload(path: str, key: str) -> str:
    """Store a local file under key. Returns the logical key stored in jobs.result_url."""
    if not is_s3():
        dest = os.path.join(_root(), key)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.move(path, dest)
        return key
    _s3().upload_file(path, settings.S3_BUCKET, key)
    try:
        os.remove(path)
    except OSError:
        pass
    return key


def resolve(key: str) -> str | None:
    """Map a logical key to an absolute local path (downloading from S3 first
    when needed), or None if missing."""
    if not is_s3():
        path = os.path.normpath(os.path.join(_root(), key))
        if not path.startswith(_root()) or not os.path.exists(path):
            return None
        return path
    path = _cache_path(key)
    if os.path.exists(path):
        return path
    try:
        _s3().download_file(settings.S3_BUCKET, key, path)
    except Exception:
        return None
    return path


def download(key: str, dest: str) -> str | None:
    """Fetch key to an exact local destination (pipeline resume paths).
    Returns dest, or None when the object does not exist."""
    if not is_s3():
        src = resolve(key)
        if src is None:
            return None
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(src, dest)
        return dest
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        _s3().download_file(settings.S3_BUCKET, key, dest)
    except Exception:
        return None
    return dest


def delete(key: str) -> None:
    """Remove a stored object if it exists. Never raises."""
    try:
        if not is_s3():
            path = os.path.normpath(os.path.join(_root(), key))
            if path.startswith(_root()) and os.path.exists(path):
                os.remove(path)
        else:
            _s3().delete_object(Bucket=settings.S3_BUCKET, Key=key)
    except OSError:
        pass
    except Exception:
        pass


def stat(key: str) -> dict | None:
    """Metadata for a stored object ({size_bytes, content_type}) or None."""
    if not is_s3():
        path = os.path.normpath(os.path.join(_root(), key))
        if not path.startswith(_root()) or not os.path.exists(path):
            return None
        return {"size_bytes": os.path.getsize(path), "content_type": None}
    try:
        head = _s3().head_object(Bucket=settings.S3_BUCKET, Key=key)
    except Exception:
        return None
    return {
        "size_bytes": head.get("ContentLength"),
        "content_type": head.get("ContentType"),
    }


# --- Presigned URLs (S3 backend only; minted after ownership checks upstream) ---


def presign_get(key: str, ttl: int, filename: str | None = None) -> str:
    """Short-lived GET URL. Forces download disposition to prevent inline sniffing."""
    params = {"Bucket": settings.S3_BUCKET, "Key": key}
    if filename:
        params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        params["ResponseContentType"] = "video/mp4"
    return _s3().generate_presigned_url("get_object", Params=params, ExpiresIn=ttl)


def presign_put(key: str, ttl: int, content_type: str) -> str:
    return _s3().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=ttl,
    )


# --- Multipart helpers (user background uploads land via these in phase 2) ---


def create_multipart(key: str, content_type: str) -> str:
    resp = _s3().create_multipart_upload(Bucket=settings.S3_BUCKET, Key=key, ContentType=content_type)
    return resp["UploadId"]


def presign_part(key: str, upload_id: str, part_number: int, ttl: int) -> str:
    return _s3().generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=ttl,
    )


def complete_multipart(key: str, upload_id: str, parts: list[dict]) -> None:
    _s3().complete_multipart_upload(
        Bucket=settings.S3_BUCKET,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={"Parts": sorted(parts, key=lambda p: p["PartNumber"])},
    )


def list_parts(key: str, upload_id: str) -> list[dict]:
    """Server-side listing of uploaded parts. Used instead of trusting
    client-supplied part/ETag lists on complete."""
    parts = []
    paginator = _s3().get_paginator("list_parts")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET, Key=key, UploadId=upload_id):
        for p in page.get("Parts", []):
            parts.append({"PartNumber": p["PartNumber"], "ETag": p["ETag"]})
    return parts


def abort_multipart(key: str, upload_id: str) -> None:
    try:
        _s3().abort_multipart_upload(Bucket=settings.S3_BUCKET, Key=key, UploadId=upload_id)
    except Exception:
        pass
