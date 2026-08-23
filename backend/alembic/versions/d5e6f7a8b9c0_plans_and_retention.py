"""Plan.md phase 3: user plans + reel retention lifecycle."""

revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column("users", sa.Column("plan", sa.Text(), nullable=False, server_default="free"))
    op.add_column("jobs", sa.Column("retention", sa.Text(), nullable=False, server_default="ephemeral"))
    op.add_column("jobs", sa.Column("result_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("result_expired_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_jobs_reaper",
        "jobs",
        ["status", "retention", "result_expires_at"],
        postgresql_where=sa.text("result_url IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_reaper", table_name="jobs")
    op.drop_column("jobs", "result_expired_at")
    op.drop_column("jobs", "result_expires_at")
    op.drop_column("jobs", "retention")
    op.drop_column("users", "plan")
