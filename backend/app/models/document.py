import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import AuditMixin, Base, DBUUID, TimestampMixin, uuid_pk

DOCUMENT_TYPES = ("RECEIPT", "ISSUE")


class DyeingDocument(Base, AuditMixin):
    __tablename__ = "dyeing_documents"
    __table_args__ = (
        UniqueConstraint("document_type", "challan_no", name="uq_dyeing_document_type_challan"),
        CheckConstraint("document_type IN ('RECEIPT', 'ISSUE')", name="ck_dyeing_document_type"),
        CheckConstraint("status IN ('draft', 'saved')", name="ck_dyeing_document_status"),
        Index("ix_dyeing_documents_document_date", "document_date"),
        Index("ix_dyeing_documents_document_type", "document_type"),
        Index("ix_dyeing_documents_customer_id", "customer_id"),
        Index("ix_dyeing_documents_vehicle_no", "vehicle_no"),
        Index("ix_dyeing_documents_challan_no", "challan_no"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    document_type: Mapped[str] = mapped_column(String(16), nullable=False)
    challan_no: Mapped[str] = mapped_column(String(60), nullable=False)
    serial_no: Mapped[str | None] = mapped_column(String(60), nullable=True)
    document_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), server_default="saved", nullable=False)

    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        DBUUID, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        DBUUID, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    tax_account_id: Mapped[uuid.UUID | None] = mapped_column(
        DBUUID, ForeignKey("tax_accounts.id", ondelete="SET NULL"), nullable=True
    )
    vehicle_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    through: Mapped[str | None] = mapped_column(String(200), nullable=True)
    through_dyeing: Mapped[str | None] = mapped_column(String(200), nullable=True)
    remarks: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # ISSUE-only flags
    issue_to_tubitor: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    issue_to_redyeing: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    non_paid: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    redyeing_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    tubitor_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    eway_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    shipping: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Totals — always recalculated server-side; clients cannot set them.
    total_rolls: Mapped[Decimal] = mapped_column(Numeric(18, 3), server_default="0.000", nullable=False)
    total_qty: Mapped[Decimal] = mapped_column(Numeric(18, 3), server_default="0.000", nullable=False)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0.00", nullable=False)
    round_off: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0.00", nullable=False)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0.00", nullable=False)

    # Synchronisation: the app's native challan JSON, kept verbatim so an offline
    # device can restore its exact data_json on pull without re-mapping columns.
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["DyeingDocumentItem"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DyeingDocumentItem.line_no",
        passive_deletes=True,
    )
    customer: Mapped["Customer | None"] = relationship("Customer")


class DyeingDocumentItem(Base, TimestampMixin):
    __tablename__ = "dyeing_document_items"
    __table_args__ = (
        UniqueConstraint("dyeing_document_id", "line_no", name="uq_dyeing_document_item_line"),
        Index("ix_dyeing_document_items_dyeing_document_id", "dyeing_document_id"),
        Index("ix_dyeing_document_items_lot_no", "lot_no"),
        Index("ix_dyeing_document_items_item_id", "item_id"),
        Index("ix_dyeing_document_items_colour_id", "colour_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    dyeing_document_id: Mapped[uuid.UUID] = mapped_column(
        DBUUID, ForeignKey("dyeing_documents.id", ondelete="CASCADE"), nullable=False
    )
    line_no: Mapped[int] = mapped_column(nullable=False)
    lot_no: Mapped[str | None] = mapped_column(String(60), nullable=True)
    item_id: Mapped[uuid.UUID | None] = mapped_column(DBUUID, ForeignKey("items.id"), nullable=True)
    dyeing_type_id: Mapped[uuid.UUID | None] = mapped_column(DBUUID, ForeignKey("dyeing_types.id"), nullable=True)
    colour_id: Mapped[uuid.UUID | None] = mapped_column(DBUUID, ForeignKey("colours.id"), nullable=True)
    colour_group_id: Mapped[uuid.UUID | None] = mapped_column(DBUUID, ForeignKey("colour_groups.id"), nullable=True)
    process_id: Mapped[uuid.UUID | None] = mapped_column(DBUUID, ForeignKey("processes.id"), nullable=True)

    rolls: Mapped[Decimal] = mapped_column(Numeric(18, 3), server_default="0.000", nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), server_default="0.000", nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0.00", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0.00", nullable=False)

    document: Mapped["DyeingDocument"] = relationship(back_populates="items")
    item: Mapped["Item | None"] = relationship("Item")
    colour: Mapped["Colour | None"] = relationship("Colour")