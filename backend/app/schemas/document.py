import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.auth import RefRead  # re-exported below for document schemas


class DyeingItemCreate(BaseModel):
    line_no: int = Field(..., ge=1)
    lot_no: str | None = None
    item_id: uuid.UUID | None = None
    dyeing_type_id: uuid.UUID | None = None
    colour_id: uuid.UUID | None = None
    colour_group_id: uuid.UUID | None = None
    process_id: uuid.UUID | None = None
    rolls: Decimal = Decimal("0.000")
    quantity: Decimal = Decimal("0.000")
    rate: Decimal = Decimal("0.00")

    @field_validator("rolls", "quantity", "rate")
    @classmethod
    def non_negative(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("rolls/quantity/rate must be >= 0")
        return v


class DyeingItemUpdate(DyeingItemCreate):
    id: uuid.UUID | None = None


class DyeingDocumentCreate(BaseModel):
    document_type: Literal["RECEIPT", "ISSUE"]
    challan_no: str = Field(..., min_length=1, max_length=60)
    serial_no: str | None = None
    document_date: date
    status: Literal["draft", "saved"] = "saved"
    customer_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
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
    tax_account_id: uuid.UUID | None = None
    round_off: Decimal = Decimal("0.00")
    items: list[DyeingItemCreate] = Field(..., min_length=1)


class DyeingDocumentUpdate(BaseModel):
    challan_no: str | None = Field(default=None, min_length=1, max_length=60)
    serial_no: str | None = None
    document_date: date | None = None
    status: Literal["draft", "saved"] | None = None
    customer_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    vehicle_no: str | None = None
    through: str | None = None
    through_dyeing: str | None = None
    remarks: str | None = None
    issue_to_tubitor: bool | None = None
    issue_to_redyeing: bool | None = None
    non_paid: bool | None = None
    redyeing_ref: str | None = None
    tubitor_ref: str | None = None
    eway_no: str | None = None
    shipping: str | None = None
    tax_account_id: uuid.UUID | None = None
    round_off: Decimal | None = None
    items: list[DyeingItemUpdate] | None = None


class DyeingDocumentListItem(BaseModel):
    id: uuid.UUID
    document_type: Literal["RECEIPT", "ISSUE"]
    challan_no: str
    serial_no: str | None
    document_date: date
    status: str
    customer: RefRead | None
    vehicle_no: str | None
    remarks: str | None
    total_rolls: Decimal
    total_qty: Decimal
    gross_amount: Decimal
    net_amount: Decimal
    updated_at: datetime


class DyeingDocumentListResp(BaseModel):
    items: list[DyeingDocumentListItem]
    total: int
    page: int
    page_size: int


class DyeingItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    line_no: int
    lot_no: str | None
    item: RefRead | None
    dyeing_type: RefRead | None
    colour: RefRead | None
    colour_group: RefRead | None
    process: RefRead | None
    rolls: Decimal
    quantity: Decimal
    rate: Decimal
    amount: Decimal


class DyeingDocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_type: Literal["RECEIPT", "ISSUE"]
    challan_no: str
    serial_no: str | None
    document_date: date
    status: str
    customer: RefRead | None
    category: RefRead | None
    vehicle_no: str | None
    through: str | None
    through_dyeing: str | None
    remarks: str | None
    issue_to_tubitor: bool
    issue_to_redyeing: bool
    non_paid: bool
    redyeing_ref: str | None
    tubitor_ref: str | None
    eway_no: str | None
    shipping: str | None
    tax_account: RefRead | None
    total_rolls: Decimal
    total_qty: Decimal
    gross_amount: Decimal
    round_off: Decimal
    net_amount: Decimal
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    items: list[DyeingItemRead]