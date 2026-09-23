import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import (
    Category,
    Colour,
    ColourGroup,
    Customer,
    Depth,
    DyeingType,
    HsnCode,
    Item,
    Process,
    RateCard,
    Shade,
    TaxAccount,
    User,
)
from app.schemas.master import MasterCreate, MasterRead, MasterUpdate

router = APIRouter(prefix="/masters", tags=["masters"])

# kind -> (model, accepted payload fields, payload fields that are required)
KINDS: dict[str, tuple[type, list[str], list[str]]] = {
    "customers": (Customer, ["name", "gstin", "address", "state", "state_code", "email", "phone"], ["name"]),
    "categories": (Category, ["name"], ["name"]),
    "items": (Item, ["name", "unit", "hsn_id"], ["name"]),
    "dyeing-types": (DyeingType, ["name"], ["name"]),
    "colours": (Colour, ["name", "hex"], ["name"]),
    "colour-groups": (ColourGroup, ["name"], ["name"]),
    "processes": (Process, ["name", "contact_name", "phone"], ["name"]),
    "tax-accounts": (TaxAccount, ["name", "tax_rate"], ["name"]),
    "hsn-codes": (HsnCode, ["name", "code", "description", "tax_rate"], ["code"]),
    "depths": (Depth, ["name"], ["name"]),
    "shades": (Shade, ["colour_id", "depth_id"], ["colour_id", "depth_id"]),
    "rate-cards": (RateCard, ["customer_id", "process", "depth", "fabric_quality", "value"], ["value"]),
}


def _kind(kind: str) -> tuple[type, list[str], list[str]]:
    if kind not in KINDS:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Unknown master kind. Valid kinds: {', '.join(sorted(KINDS))}",
        )
    return KINDS[kind]


def _row_to_read(row: object, fields: list[str]) -> MasterRead:
    data: dict[str, object] = {
        "id": row.id,
        "name": getattr(row, "name", None) or getattr(row, "code", "") or str(row.id),
        "active": getattr(row, "active", True),
    }
    for f in fields + ["gstin", "address", "state", "state_code", "email", "phone", "hex",
                       "unit", "hsn_id", "contact_name", "code", "description", "tax_rate",
                       "customer_id", "process", "depth", "fabric_quality", "value",
                       "colour_id", "depth_id"]:
        if f in ("name", "active"):
            continue
        if hasattr(row, f):
            data[f] = getattr(row, f)
    data["created_at"] = getattr(row, "created_at", datetime.now(timezone.utc))
    data["updated_at"] = getattr(row, "updated_at", datetime.now(timezone.utc))
    return MasterRead(**data)


def _has_name(model: type) -> bool:
    return "name" in model.__table__.columns


@router.get("/{kind}", response_model=list[MasterRead])
async def list_masters(
    kind: str,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[MasterRead]:
    model, fields, _ = _kind(kind)
    order_col = model.__table__.c.name if _has_name(model) else model.__table__.c.id
    stmt = select(model).order_by(order_col)
    if q and _has_name(model):
        stmt = stmt.where(func.lower(model.name).like(func.lower(f"%{q}%")))
    rows = (await db.execute(stmt)).scalars().all()
    return [_row_to_read(r, fields) for r in rows]


@router.post("/{kind}", response_model=MasterRead, status_code=status.HTTP_201_CREATED)
async def create_master(
    kind: str,
    body: MasterCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> MasterRead:
    model, fields, required = _kind(kind)
    data = body.model_dump(exclude_unset=True)
    for req in required:
        if req not in data or data[req] is None or data[req] in ("", [], {}):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{req}' is required for {kind}")
    try:
        if _has_name(model):
            name = data.get("name")
            if not name or not str(name).strip():
                if kind == "hsn-codes" and data.get("code"):
                    name = data["code"]
                else:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "name is required")
            row = model(name=str(name).strip(), active=bool(data.get("active", True)))
        elif kind == "shades":
            row = Shade(colour_id=data["colour_id"], depth_id=data["depth_id"])
        else:
            row = model()
        for f in fields:
            if f in ("name", "active"):
                continue
            if f in data:
                setattr(row, f, data[f])
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return _row_to_read(row, fields)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A record with the same key already exists")


@router.put("/{kind}/{master_id}", response_model=MasterRead)
async def update_master(
    kind: str,
    master_id: uuid.UUID,
    body: MasterUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> MasterRead:
    model, fields, _ = _kind(kind)
    row = await db.get(model, master_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Master record not found")
    data = body.model_dump(exclude_unset=True)
    try:
        for f in fields:
            if f == "name" and "name" in data:
                setattr(row, f, str(data[f]).strip())
            elif f != "name" and f in data:
                setattr(row, f, data[f])
        if "active" in data and hasattr(row, "active"):
            row.active = data["active"]
        await db.commit()
        await db.refresh(row)
        return _row_to_read(row, fields)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A record with the same key already exists")


@router.delete("/{kind}/{master_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_master(
    kind: str,
    master_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    model, _, _ = _kind(kind)
    row = await db.get(model, master_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Master record not found")
    try:
        await db.delete(row)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Record is referenced by documents and cannot be deleted"
        )