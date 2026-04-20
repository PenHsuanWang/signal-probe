import uuid

from sqlalchemy import Double, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SignalGroup(Base):
    __tablename__ = "signal_groups"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    members: Mapped[list["SignalGroupMember"]] = relationship(
        "SignalGroupMember", back_populates="group", cascade="all, delete-orphan"
    )


class SignalGroupMember(Base):
    __tablename__ = "signal_group_members"

    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("signal_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    signal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("signal_metadata.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    display_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # JSON: {"ch_name": "#hex_color", ...}  — per-channel color override
    channel_colors: Mapped[str | None] = mapped_column(Text, nullable=True)
    # seconds to shift this signal's timeline relative to the group reference
    time_offset_s: Mapped[float] = mapped_column(
        Double, nullable=False, default=0.0, server_default="0.0"
    )

    group: Mapped["SignalGroup"] = relationship("SignalGroup", back_populates="members")
