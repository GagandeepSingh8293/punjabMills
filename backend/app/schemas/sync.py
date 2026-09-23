import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.document import DyeingItemCreate


class SyncItemRow(DyeingItemCreate):
    pass


class SyncDocumentRow(BaseModel):
    """Wire shape for a document travelling to/from a device. `challan_date`
    (not `document_date`) matches the desktop app's vocabulary."""

    id: uuid.UUID
    updated_at: datetime
    document_type: Literal["RECEIPT", "ISSUE"]
    challan_no: str = Field(..., min_length=1, max_length=60)
    serial_no: str | None = None
    challan_date: date
    status: Literal["draft", "saved"] = "saved"
    customer_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    tax_account_id: uuid.UUID | None = None
    vehicle_no: str | None = None
    through: str | None = None
    through_dyeing: str | None = None
    remarks: str | None = None
    issue_to_tubitor: bool = False
    issue_to_redyeing: bool = False
    non_paid: bool = False
    redyeing_ref: str | None = None
    tubitor_ref: str | None = None
    eway_no: str | None = None
    shipping: str | None = None
    round_off: Decimal = Decimal("0.00")
    items: list[SyncItemRow] = []
    raw_json: str | None = None


class SyncTombstoneRow(BaseModel):
    table: str
    row_id: uuid.UUID
    deleted_at: datetime | None = None


class SyncPushRequest(BaseModel):
    device_id: str | None = None
    masters: dict[str, list[dict[str, Any]]] = {}
    documents: list[SyncDocumentRow] = []
    tombstones: list[SyncTombstoneRow] = []


class SyncPushResponse(BaseModel):
    server_now: datetime
    masters: dict[str, list[dict[str, Any]]] = {}
    documents: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []


class SyncPullResponse(BaseModel):
    server_now: datetime
    masters: dict[str, list[dict[str, Any]]] = {}
    documents: list[dict[str, Any]] = []
    tombstones: list[dict[str, Any]] = []


class SyncHealthResponse(BaseModel):
    status: Literal["ok"]
    server_time: datetime
    version: str = "1"