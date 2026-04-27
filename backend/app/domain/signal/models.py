import uuid

from sqlalchemy import BigInteger, Double, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SignalMetadata(Base):
    __tablename__ = "signal_metadata"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    processed_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="PENDING", server_default="PENDING"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_points: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    active_run_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # JSON-encoded list of channel names, e.g. '["value"]' or '["temp","pressure"]'
    channel_names: Mapped[str | None] = mapped_column(Text, nullable=True)
    # User-selected column configuration (AWAITING_CONFIG → PENDING transition)
    time_column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    signal_columns: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list

    runs: Mapped[list["RunSegment"]] = relationship(
        "RunSegment", back_populates="signal", cascade="all, delete-orphan"
    )


class RunSegment(Base):
    __tablename__ = "run_segments"

    signal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("signal_metadata.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_index: Mapped[int] = mapped_column(Integer, nullable=False)
    start_x: Mapped[float] = mapped_column(Double, nullable=False)
    end_x: Mapped[float] = mapped_column(Double, nullable=False)
    duration_seconds: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_max: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_min: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_mean: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_variance: Mapped[float | None] = mapped_column(Double, nullable=True)
    annotation: Mapped[str | None] = mapped_column(String(255), nullable=True)

    signal: Mapped["SignalMetadata"] = relationship(
        "SignalMetadata", back_populates="runs"
    )
