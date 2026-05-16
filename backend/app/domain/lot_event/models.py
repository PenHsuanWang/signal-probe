from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Double, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.domain.signal.models import SignalMetadata


class LotEvent(Base):
    __tablename__ = "lot_events"
    __table_args__ = (
        UniqueConstraint("signal_id", "lot_id", name="uq_lot_events_signal_lot"),
    )

    signal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("signal_metadata.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lot_id: Mapped[str] = mapped_column(String(64), nullable=False)
    recipe: Mapped[str] = mapped_column(String(128), nullable=False)
    wafer_count: Mapped[int] = mapped_column(Integer, nullable=False)
    check_in_time: Mapped[float] = mapped_column(Double, nullable=False)
    check_out_time: Mapped[float] = mapped_column(Double, nullable=False)

    signal: Mapped[SignalMetadata] = relationship(
        "SignalMetadata", back_populates="lot_events"
    )
