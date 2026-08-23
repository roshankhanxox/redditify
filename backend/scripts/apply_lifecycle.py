"""Apply the bucket lifecycle policy from plan.md section 9.

Idempotent: reads the current configuration and puts the full desired set.
Safe to run repeatedly against MinIO (dev) or real S3 (prod bootstrap).

Rules:
- scratch/{job_id}/... intermediates expire after SCRATCH_TTL_HOURS (min 1 day
  granularity in S3, so 24 h -> 1 day).
- Incomplete multipart uploads are aborted after 7 days anywhere in the bucket,
  killing abandoned background uploads that never reached /complete.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings  # noqa: E402


def main() -> int:
    if settings.STORAGE_BACKEND != "s3":
        print(f"STORAGE_BACKEND={settings.STORAGE_BACKEND} — nothing to do")
        return 0

    import boto3
    from botocore.config import Config

    kwargs = {"region_name": settings.S3_REGION}
    if settings.S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.S3_ENDPOINT_URL
        kwargs["config"] = Config(s3={"addressing_style": "path"}, signature_version="s3v4")
    if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
        kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
        kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
    client = boto3.client("s3", **kwargs)

    scratch_days = max(1, int(getattr(settings, "SCRATCH_TTL_HOURS", 24) / 24) or 1)
    configuration = {
        "Rules": [
            {
                "ID": "expire-scratch-artifacts",
                "Status": "Enabled",
                "Filter": {"Prefix": "scratch/"},
                "Expiration": {"Days": scratch_days},
            },
            {
                # Bucket-wide abort of multipart uploads initiated but never
                # completed within 7 days (abandoned background uploads).
                # NOTE: MinIO rejects rules whose only action is an abort, so
                # this carries an intentionally inert 100-year expiration.
                # On real S3 you can drop "Expiration" from this rule.
                "ID": "abort-stale-multipart-uploads",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "Expiration": {"Days": 36500},
                "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
            },
        ]
    }
    client.put_bucket_lifecycle_configuration(
        Bucket=settings.S3_BUCKET, LifecycleConfiguration=configuration
    )
    current = client.get_bucket_lifecycle_configuration(Bucket=settings.S3_BUCKET)
    applied = [r.get("ID") for r in current.get("Rules", [])]
    print(f"Lifecycle applied to {settings.S3_BUCKET}: {applied}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
