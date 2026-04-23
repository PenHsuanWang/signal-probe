"""Remove ooc_count columns — OOC state eliminated.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-23 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("signal_metadata", "ooc_count")
    op.drop_column("run_segments", "ooc_count")


def downgrade() -> None:
    op.add_column(
        "run_segments",
        sa.Column("ooc_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "signal_metadata",
        sa.Column("ooc_count", sa.Integer(), nullable=False, server_default="0"),
    )
