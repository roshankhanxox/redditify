"""Add user_backgrounds.kind — footage | image | character cutouts."""

revision = "e9f0a1b2c3d4"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column(
        "user_backgrounds",
        sa.Column("kind", sa.Text(), nullable=False, server_default="video"),
    )


def downgrade() -> None:
    op.drop_column("user_backgrounds", "kind")
