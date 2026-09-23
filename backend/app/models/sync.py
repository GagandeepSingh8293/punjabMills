import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DBUUID


class SyncTombstone(Base):
    """Rows deleted on one device, broadcast to the others via pull."""

    __tablename__ = "sync_tombstones"
    __table_args__ = (
        UniqueConstraint("table_name", "row_id", name="uq_sync_tombstone"),
    )

    table_name: Mapped[str] = mapped_column(String(60), primary_key=True)
    row_id: Mapped[uuid.UUID] = mapped_column(DBUUID, primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )