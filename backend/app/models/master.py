import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AuditMixin, Base, DBUUID, uuid_pk


class MasterBase(Base, AuditMixin):
    __abstract__ = True

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(server_default="true", nullable=False)

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.id} name={self.name!r}>"


class Customer(MasterBase):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("name"),)

    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True, index=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    state_code: Mapped[str | None] = mapped_column(String(5), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)


class Category(MasterBase):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("name"),)


class Item(MasterBase):
    __tablename__ = "items"
    __table_args__ = (UniqueConstraint("name"),)

    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hsn_id: Mapped[uuid.UUID | None] = mapped_column(DBUUID, ForeignKey("hsn_codes.id"), nullable=True)


class DyeingType(MasterBase):
    __tablename__ = "dyeing_types"
    __table_args__ = (UniqueConstraint("name"),)


class Colour(MasterBase):
    __tablename__ = "colours"
    __table_args__ = (UniqueConstraint("name"),)

    hex: Mapped[str | None] = mapped_column(String(7), nullable=True)


class ColourGroup(MasterBase):
    __tablename__ = "colour_groups"
    __table_args__ = (UniqueConstraint("name"),)


class Process(MasterBase):
    __tablename__ = "processes"
    __table_args__ = (UniqueConstraint("name"),)

    contact_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)


class TaxAccount(MasterBase):
    __tablename__ = "tax_accounts"
    __table_args__ = (UniqueConstraint("name"),)

    gst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="0.00", nullable=False)


class HsnCode(Base, AuditMixin):
    __tablename__ = "hsn_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="0.00", nullable=False)


class Depth(MasterBase):
    __tablename__ = "depths"
    __table_args__ = (UniqueConstraint("name"),)


class Shade(Base, AuditMixin):
    __tablename__ = "shades"
    __table_args__ = (UniqueConstraint("colour_id", "depth_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    colour_id: Mapped[uuid.UUID] = mapped_column(DBUUID, ForeignKey("colours.id", ondelete="CASCADE"), nullable=False)
    depth_id: Mapped[uuid.UUID] = mapped_column(DBUUID, ForeignKey("depths.id", ondelete="CASCADE"), nullable=False)


class RateCard(Base, AuditMixin):
    __tablename__ = "rate_cards"

    id: Mapped[uuid.UUID] = uuid_pk()
    customer_id: Mapped[uuid.UUID | None] = mapped_column(DBUUID, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True)
    process: Mapped[str | None] = mapped_column(String(120), nullable=True)
    depth: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fabric_quality: Mapped[str | None] = mapped_column(String(120), nullable=True)
    value: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0.00", nullable=False)