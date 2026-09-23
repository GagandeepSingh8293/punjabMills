import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class MasterCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    active: bool = True
    # Optional fields; only those matching the master kind are persisted.
    gstin: str | None = None
    address: str | None = None
    state: str | None = None
    state_code: str | None = None
    email: str | None = None
    phone: str | None = None
    hex: str | None = None
    unit: str | None = None
    hsn_id: uuid.UUID | None = None
    contact_name: str | None = None
    code: str | None = None
    description: str | None = None
    tax_rate: Decimal | None = None
    customer_id: uuid.UUID | None = None
    process: str | None = None
    depth: str | None = None
    fabric_quality: str | None = None
    value: Decimal | None = None
    colour_id: uuid.UUID | None = None
    depth_id: uuid.UUID | None = None


class MasterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    active: bool | None = None
    gstin: str | None = None
    address: str | None = None
    state: str | None = None
    state_code: str | None = None
    email: str | None = None
    phone: str | None = None
    hex: str | None = None
    unit: str | None = None
    hsn_id: uuid.UUID | None = None
    contact_name: str | None = None
    code: str | None = None
    description: str | None = None
    tax_rate: Decimal | None = None
    customer_id: uuid.UUID | None = None
    process: str | None = None
    depth: str | None = None
    fabric_quality: str | None = None
    value: Decimal | None = None
    colour_id: uuid.UUID | None = None
    depth_id: uuid.UUID | None = None


class MasterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    active: bool
    gstin: str | None = None
    address: str | None = None
    state: str | None = None
    state_code: str | None = None
    email: str | None = None
    phone: str | None = None
    hex: str | None = None
    unit: str | None = None
    hsn_id: uuid.UUID | None = None
    contact_name: str | None = None
    code: str | None = None
    description: str | None = None
    tax_rate: Decimal | None = None
    customer_id: uuid.UUID | None = None
    process: str | None = None
    depth: str | None = None
    fabric_quality: str | None = None
    value: Decimal | None = None
    colour_id: uuid.UUID | None = None
    depth_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime