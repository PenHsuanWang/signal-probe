"""Add channel_names to signal_metadata; add signal_groups + signal_group_members.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── signal_metadata: add channel_names ──────────────────────────────────
    op.add_column(
        "signal_metadata",
        sa.Column("channel_names", sa.Text(), nullable=True),
    )

    # ── signal_groups ────────────────────────────────────────────────────────
    op.create_table(
        "signal_groups",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_signal_groups_owner_id", "signal_groups", ["owner_id"])

    # ── signal_group_members ─────────────────────────────────────────────────
    op.create_table(
        "signal_group_members",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column("signal_id", sa.UUID(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("channel_colors", sa.Text(), nullable=True),
        sa.Column("time_offset_s", sa.Double(), nullable=False, server_default="0.0"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["group_id"], ["signal_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["signal_id"], ["signal_metadata.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_signal_group_members_group_id", "signal_group_members", ["group_id"]
    )
    op.create_index(
        "ix_signal_group_members_signal_id", "signal_group_members", ["signal_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_signal_group_members_signal_id", table_name="signal_group_members"
    )
    op.drop_index("ix_signal_group_members_group_id", table_name="signal_group_members")
    op.drop_table("signal_group_members")
    op.drop_index("ix_signal_groups_owner_id", table_name="signal_groups")
    op.drop_table("signal_groups")
    op.drop_column("signal_metadata", "channel_names")
