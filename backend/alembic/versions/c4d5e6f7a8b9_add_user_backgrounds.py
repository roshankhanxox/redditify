"""Add user_backgrounds table (plan.md phase 2 — user-uploaded footage)."""

revision = "c4d5e6f7a8b9"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


def upgrade() -> None:
    op.create_table(
        "user_backgrounds",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("label", sa.Text(), nullable=False, server_default=""),
        sa.Column("upload_id", sa.Text(), nullable=True),
        sa.Column("source_key", sa.Text(), nullable=False, server_default=""),
        sa.Column("clip_key", sa.Text(), nullable=True),
        sa.Column("preview_key", sa.Text(), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_user_backgrounds_user_id", "user_backgrounds", ["user_id"])
    op.create_index("ix_user_backgrounds_status", "user_backgrounds", ["status"])


def downgrade() -> None:
    op.drop_table("user_backgrounds")
