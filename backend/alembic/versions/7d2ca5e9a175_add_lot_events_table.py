"""add_lot_events_table

Revision ID: 7d2ca5e9a175
Revises: d4e5f6a7b8c9
Create Date: 2026-05-11 03:10:35.684868

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7d2ca5e9a175"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "lot_events",
        sa.Column("signal_id", sa.Uuid(), nullable=False),
        sa.Column("lot_id", sa.String(length=64), nullable=False),
        sa.Column("recipe", sa.String(length=128), nullable=False),
        sa.Column("wafer_count", sa.Integer(), nullable=False),
        sa.Column("check_in_time", sa.Double(), nullable=False),
        sa.Column("check_out_time", sa.Double(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["signal_id"], ["signal_metadata.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("signal_id", "lot_id", name="uq_lot_events_signal_lot"),
    )
    op.create_index(
        op.f("ix_lot_events_signal_id"), "lot_events", ["signal_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_lot_events_signal_id"), table_name="lot_events")
    op.drop_table("lot_events")
