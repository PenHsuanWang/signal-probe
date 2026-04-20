"""Initial schema — users, signal_metadata, run_segments.

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-04-18 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_superuser", sa.Boolean(), nullable=False, server_default="false"),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "signal_metadata",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("processed_file_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("total_points", sa.BigInteger(), nullable=True),
        sa.Column("active_run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ooc_count", sa.Integer(), nullable=False, server_default="0"),
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
    op.create_index("ix_signal_metadata_owner_id", "signal_metadata", ["owner_id"])

    op.create_table(
        "run_segments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("signal_id", sa.UUID(), nullable=False),
        sa.Column("run_index", sa.Integer(), nullable=False),
        sa.Column("start_x", sa.Double(), nullable=False),
        sa.Column("end_x", sa.Double(), nullable=False),
        sa.Column("duration_seconds", sa.Double(), nullable=True),
        sa.Column("value_max", sa.Double(), nullable=True),
        sa.Column("value_min", sa.Double(), nullable=True),
        sa.Column("value_mean", sa.Double(), nullable=True),
        sa.Column("value_variance", sa.Double(), nullable=True),
        sa.Column("ooc_count", sa.Integer(), nullable=False, server_default="0"),
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
        sa.ForeignKeyConstraint(
            ["signal_id"], ["signal_metadata.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_run_segments_signal_id", "run_segments", ["signal_id"])


def downgrade() -> None:
    op.drop_index("ix_run_segments_signal_id", table_name="run_segments")
    op.drop_table("run_segments")
    op.drop_index("ix_signal_metadata_owner_id", table_name="signal_metadata")
    op.drop_table("signal_metadata")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
