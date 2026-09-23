import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func, types
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class DBUUID(types.TypeDecorator[uuid.UUID]):
    """UUID stored as native Postgres uuid (UUID type) in this project."""
    impl = types.UUID
    cache_ok = True


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class AuditMixin(TimestampMixin):
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        DBUUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        DBUUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(DBUUID, primary_key=True, default=uuid.uuid4)