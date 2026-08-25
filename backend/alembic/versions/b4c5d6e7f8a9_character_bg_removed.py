"""Add user_backgrounds.bg_removed for character cutouts."""

revision = "b4c5d6e7f8a9"
down_revision = "e9f0a1b2c3d4"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column(
        "user_backgrounds",
        sa.Column("bg_removed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("user_backgrounds", "bg_removed")
