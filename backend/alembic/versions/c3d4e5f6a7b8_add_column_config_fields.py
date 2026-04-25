"""Add time_column and signal_columns to signal_metadata (EPIC-FLX).

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # User-selected time axis column name
    op.add_column(
        "signal_metadata",
        sa.Column("time_column", sa.String(255), nullable=True),
    )
    # JSON-encoded list of user-selected signal channel column names
    op.add_column(
        "signal_metadata",
        sa.Column("signal_columns", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("signal_metadata", "signal_columns")
    op.drop_column("signal_metadata", "time_column")
