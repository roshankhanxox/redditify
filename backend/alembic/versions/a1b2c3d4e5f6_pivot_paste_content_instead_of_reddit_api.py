"""Pivot: Reddit API removed — users paste story content directly.

- jobs.post_id dropped
- jobs.post_body added (pasted story text)
- jobs.post_title now NOT NULL
"""

revision = "a1b2c3d4e5f6"
down_revision = "34714a7d8efc"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    # Dev-stage table only contained reddit-id test rows; safe to clear
    op.execute("DELETE FROM jobs")
    op.drop_column("jobs", "post_id")
    op.add_column("jobs", sa.Column("post_body", sa.Text(), nullable=False, server_default=""))
    op.alter_column("jobs", "post_title", existing_type=sa.Text(), nullable=False)


def downgrade() -> None:
    op.alter_column("jobs", "post_title", existing_type=sa.Text(), nullable=True)
    op.drop_column("jobs", "post_body")
    op.add_column("jobs", sa.Column("post_id", sa.Text(), nullable=False, server_default="legacy"))
