"""Add clip_jobs and clips tables for the content engine."""

revision = "f1a2b3c4d5e6"
down_revision = "e9f0a1b2c3d4"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


def upgrade() -> None:
    op.create_table(
        "clip_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_key", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_label", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="QUEUED"),
        sa.Column("settings", JSONB(), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text()),
        sa.Column("clip_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_clip_jobs_user_id", "clip_jobs", ["user_id"])

    op.create_table(
        "clips",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("clip_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.Column("start_seconds", sa.Float(), nullable=False),
        sa.Column("end_seconds", sa.Float(), nullable=False),
        sa.Column("hook", sa.Text(), nullable=False, server_default=""),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("engagement_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("clip_type", sa.Text(), nullable=False, server_default=""),
        sa.Column("result_key", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("duration_seconds", sa.Float()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_clips_job_id", "clips", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_clips_job_id", "clips")
    op.drop_table("clips")
    op.drop_index("ix_clip_jobs_user_id", "clip_jobs")
    op.drop_table("clip_jobs")
