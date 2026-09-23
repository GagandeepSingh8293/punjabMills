import uuid
import logging
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Category,
    Colour,
    ColourGroup,
    Customer,
    DyeingDocument,
    DyeingDocumentItem,
    DyeingType,
    Item,
    Process,
    TaxAccount,
)
from app.models.document import DOCUMENT_TYPES
from app.schemas.document import (
    DyeingDocumentCreate,
    DyeingDocumentListItem,
    DyeingDocumentRead,
    DyeingDocumentUpdate,
    DyeingItemCreate,
    DyeingItemRead,
    RefRead,
)

_MONEY = Decimal("0.01")
_QTY = Decimal("0.001")


def _money(value: Decimal) -> Decimal:
    return value.quantize(_MONEY, rounding=ROUND_HALF_UP)


def _qty(value: Decimal) -> Decimal:
    return value.quantize(_QTY, rounding=ROUND_HALF_UP)


def _line_amount(quantity: Decimal, rate: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = 28
        return _money(quantity * rate)


def recalc(items: list[DyeingItemCreate]) -> dict[str, Decimal]:
    """Server-side recalculation of document totals. Clients never supply these."""
    with localcontext() as ctx:
        ctx.prec = 28
        total_rolls = sum((i.rolls for i in items), Decimal("0.000"))
        total_qty = sum((i.quantity for i in items), Decimal("0.000"))
        gross = sum((i.quantity * i.rate for i in items), Decimal("0.00"))
    return {
        "total_rolls": _qty(total_rolls),
        "total_qty": _qty(total_qty),
        "gross_amount": _money(gross),
    }


async def _ensure_entities_exist(db: AsyncSession, checks: list[tuple[type, uuid.UUID | None, str]]) -> None:
    """checks = [(Model, id, label)]. Raises 400 listing every unknown master id."""
    missing = []
    for model, entity_id, label in checks:
        if entity_id is None:
            continue
        if await db.get(model, entity_id) is None:
            missing.append(f"{label} {entity_id}")
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Referenced master does not exist: {', '.join(missing)}")


async def _check_challan_unique(
    db: AsyncSession, document_type: str, challan_no: str, exclude_id: uuid.UUID | None = None
) -> None:
    if not challan_no or not challan_no.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "challan_no is required")
    stmt = select(DyeingDocument.id).where(
        DyeingDocument.document_type == document_type,
        DyeingDocument.challan_no == challan_no.strip(),
    )
    if exclude_id is not None:
        stmt = stmt.where(DyeingDocument.id != exclude_id)
    if (await db.execute(stmt)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Challan no '{challan_no}' already exists for {document_type}")


def _validate_items(items: list[Any]) -> None:
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Document must have at least one item")
    seen: set[int] = set()
    for it in items:
        if it.line_no in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Duplicate line_no {it.line_no} in items")
        seen.add(it.line_no)
        if it.rolls < 0 or it.quantity < 0 or it.rate < 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "rolls/quantity/rate must be >= 0")


async def _validate_header_fks(
    db: AsyncSession,
    *,
    customer_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
    tax_account_id: uuid.UUID | None,
) -> None:
    await _ensure_entities_exist(
        db,
        [
            (Customer, customer_id, "customer"),
            (Category, category_id, "category"),
            (TaxAccount, tax_account_id, "tax_account"),
        ],
    )


def _build_item_records(items: list[DyeingItemCreate]) -> list[DyeingDocumentItem]:
    return [
        DyeingDocumentItem(
            line_no=it.line_no,
            lot_no=it.lot_no,
            item_id=it.item_id,
            dyeing_type_id=it.dyeing_type_id,
            colour_id=it.colour_id,
            colour_group_id=it.colour_group_id,
            process_id=it.process_id,
            rolls=it.rolls,
            quantity=it.quantity,
            rate=it.rate,
            amount=_line_amount(it.quantity, it.rate),
        )
        for it in items
    ]


async def create_document(db: AsyncSession, payload: DyeingDocumentCreate, actor_id: uuid.UUID | None) -> DyeingDocument:
    _validate_items(payload.items)
    await _validate_header_fks(
        db,
        customer_id=payload.customer_id,
        category_id=payload.category_id,
        tax_account_id=payload.tax_account_id,
    )
    checks = []
    for it in payload.items:
        checks.extend(
            [
                (Item, it.item_id, "item"),
                (DyeingType, it.dyeing_type_id, "dyeing_type"),
                (Colour, it.colour_id, "colour"),
                (ColourGroup, it.colour_group_id, "colour_group"),
                (Process, it.process_id, "process"),
            ]
        )
    await _ensure_entities_exist(db, checks)
    await _check_challan_unique(db, payload.document_type, payload.challan_no)

    totals = recalc(payload.items)
    try:
        doc = DyeingDocument(
            document_type=payload.document_type,
            challan_no=payload.challan_no.strip(),
            serial_no=payload.serial_no,
            document_date=payload.document_date,
            status=payload.status,
            customer_id=payload.customer_id,
            category_id=payload.category_id,
            vehicle_no=payload.vehicle_no,
            through=payload.through,
            through_dyeing=payload.through_dyeing,
            remarks=payload.remarks,
            issue_to_tubitor=payload.issue_to_tubitor,
            issue_to_redyeing=payload.issue_to_redyeing,
            non_paid=payload.non_paid,
            redyeing_ref=payload.redyeing_ref,
            tubitor_ref=payload.tubitor_ref,
            eway_no=payload.eway_no,
            shipping=payload.shipping,
            tax_account_id=payload.tax_account_id,
            round_off=payload.round_off,
            total_rolls=totals["total_rolls"],
            total_qty=totals["total_qty"],
            gross_amount=totals["gross_amount"],
            net_amount=_money(totals["gross_amount"] + payload.round_off),
            created_by=actor_id,
            updated_by=actor_id,
        )
        # Assign items while the doc is still transient so no prior-collection
        # load is triggered (avoids async lazy-load IO).
        doc.items = _build_item_records(payload.items)
        db.add(doc)
        await db.commit()
        return doc
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Challan no '{payload.challan_no}' already exists for {payload.document_type}",
        )


async def update_document(
    db: AsyncSession, doc: DyeingDocument, payload: DyeingDocumentUpdate, actor_id: uuid.UUID | None
) -> DyeingDocument:
    challan_no = payload.challan_no if payload.challan_no is not None else doc.challan_no
    await _validate_header_fks(
        db,
        customer_id=payload.customer_id if payload.customer_id is not None else doc.customer_id,
        category_id=payload.category_id if payload.category_id is not None else doc.category_id,
        tax_account_id=payload.tax_account_id if payload.tax_account_id is not None else doc.tax_account_id,
    )
    if payload.items is not None:
        _validate_items(payload.items)
        checks = []
        for it in payload.items:
            checks.extend(
                [
                    (Item, it.item_id, "item"),
                    (DyeingType, it.dyeing_type_id, "dyeing_type"),
                    (Colour, it.colour_id, "colour"),
                    (ColourGroup, it.colour_group_id, "colour_group"),
                    (Process, it.process_id, "process"),
                ]
            )
        await _ensure_entities_exist(db, checks)
    await _check_challan_unique(db, doc.document_type, challan_no, exclude_id=doc.id)

    try:
        for field in ("serial_no", "customer_id", "category_id", "vehicle_no", "through",
                      "through_dyeing", "remarks", "issue_to_tubitor", "issue_to_redyeing",
                      "non_paid", "redyeing_ref", "tubitor_ref", "eway_no", "shipping",
                      "tax_account_id"):
            value = getattr(payload, field)
            if value is not None:
                setattr(doc, field, value)
        if payload.document_date is not None:
            doc.document_date = payload.document_date
        if payload.status is not None:
            doc.status = payload.status
        if payload.round_off is not None:
            doc.round_off = payload.round_off
        doc.challan_no = challan_no.strip()
        doc.updated_by = actor_id

        if payload.items is not None:
            doc.items.clear()
            await db.flush()
            doc.items.extend(_build_item_records(payload.items))

        totals = recalc(doc.items)
        doc.total_rolls = totals["total_rolls"]
        doc.total_qty = totals["total_qty"]
        doc.gross_amount = totals["gross_amount"]
        doc.net_amount = _money(totals["gross_amount"] + doc.round_off)
        await db.commit()
        return doc
    except IntegrityError as _e:
        await db.rollback()
        logger.warning("document update integrity error: %s", _e.orig)
        raise HTTPException(status.HTTP_409_CONFLICT, f"Challan no '{challan_no}' already exists")


async def get_document(db: AsyncSession, document_id: uuid.UUID) -> DyeingDocument:
    from sqlalchemy.orm import selectinload

    doc = (
        await db.execute(
            select(DyeingDocument)
            .where(DyeingDocument.id == document_id)
            .options(selectinload(DyeingDocument.items))
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


async def delete_document(db: AsyncSession, document_id: uuid.UUID) -> None:
    doc = await db.get(DyeingDocument, document_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    await db.delete(doc)
    await db.commit()


# ---------------------------------------------------------------------------
# Read-model serialization: resolve {id, name} refs from the DB in bulk.
# ---------------------------------------------------------------------------

_MASTER_MODELS: dict[str, type] = {
    "customer": Customer,
    "category": Category,
    "tax_account": TaxAccount,
}


async def _collect_refs(db: AsyncSession, items: list[Any]) -> dict[str, dict[uuid.UUID, str]]:
    """Map {relationship-role: {id: name}} for one document's item refs (item, dyeing_type, ...)."""
    model_by_role: dict[str, type] = {
        "item": Item,
        "dyeing_type": DyeingType,
        "colour": Colour,
        "colour_group": ColourGroup,
        "process": Process,
    }
    refs: dict[str, dict[uuid.UUID, str]] = {role: {} for role in model_by_role}
    ids: dict[str, set[uuid.UUID]] = {
        role: {getattr(i, f"{role}_id") for i in items if getattr(i, f"{role}_id") is not None}
        for role in model_by_role
    }
    for role, model in model_by_role.items():
        if not ids[role]:
            continue
        rows = (await db.execute(select(model).where(model.id.in_(ids[role])))).scalars().all()
        refs[role] = {r.id: r.name for r in rows}
    return refs


def _document_read(
    doc: DyeingDocument,
    customer_name: str | None,
    category_name: str | None,
    tax_name: str | None,
    refs: dict[str, dict[uuid.UUID, str]],
) -> DyeingDocumentRead:
    items = [
        DyeingItemRead(
            id=it.id,
            line_no=it.line_no,
            lot_no=it.lot_no,
            item=RefRead(id=it.item_id, name=refs["item"][it.item_id]) if it.item_id in refs["item"] else None,
            dyeing_type=RefRead(id=it.dyeing_type_id, name=refs["dyeing_type"][it.dyeing_type_id])
            if it.dyeing_type_id in refs["dyeing_type"]
            else None,
            colour=RefRead(id=it.colour_id, name=refs["colour"][it.colour_id]) if it.colour_id in refs["colour"] else None,
            colour_group=RefRead(id=it.colour_group_id, name=refs["colour_group"][it.colour_group_id])
            if it.colour_group_id in refs["colour_group"]
            else None,
            process=RefRead(id=it.process_id, name=refs["process"][it.process_id]) if it.process_id in refs["process"] else None,
            rolls=it.rolls,
            quantity=it.quantity,
            rate=it.rate,
            amount=it.amount,
        )
        for it in doc.items
    ]
    return DyeingDocumentRead(
        id=doc.id,
        document_type=doc.document_type,
        challan_no=doc.challan_no,
        serial_no=doc.serial_no,
        document_date=doc.document_date,
        status=doc.status,
        customer=RefRead(id=doc.customer_id, name=customer_name) if customer_name else None,
        category=RefRead(id=doc.category_id, name=category_name) if category_name else None,
        vehicle_no=doc.vehicle_no,
        through=doc.through,
        through_dyeing=doc.through_dyeing,
        remarks=doc.remarks,
        issue_to_tubitor=doc.issue_to_tubitor,
        issue_to_redyeing=doc.issue_to_redyeing,
        non_paid=doc.non_paid,
        redyeing_ref=doc.redyeing_ref,
        tubitor_ref=doc.tubitor_ref,
        eway_no=doc.eway_no,
        shipping=doc.shipping,
        tax_account=RefRead(id=doc.tax_account_id, name=tax_name) if tax_name else None,
        total_rolls=doc.total_rolls,
        total_qty=doc.total_qty,
        gross_amount=doc.gross_amount,
        round_off=doc.round_off,
        net_amount=doc.net_amount,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        created_by=doc.created_by,
        updated_by=doc.updated_by,
        items=items,
    )


async def reload_with_items(db: AsyncSession, document_id: uuid.UUID) -> DyeingDocument:
    from sqlalchemy.orm import selectinload

    doc = (
        await db.execute(
            select(DyeingDocument)
            .where(DyeingDocument.id == document_id)
            .options(selectinload(DyeingDocument.items))
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


async def build_document_read(db: AsyncSession, doc: DyeingDocument) -> DyeingDocumentRead:
    doc = await reload_with_items(db, doc.id)
    customer_name = (await db.get(Customer, doc.customer_id)).name if doc.customer_id else None
    category_name = (await db.get(Category, doc.category_id)).name if doc.category_id else None
    tax_name = (await db.get(TaxAccount, doc.tax_account_id)).name if doc.tax_account_id else None
    refs = await _collect_refs(db, doc.items)
    return _document_read(doc, customer_name, category_name, tax_name, refs)


# ---------------------------------------------------------------------------
# Listing / search / filter options
# ---------------------------------------------------------------------------


async def list_documents(
    db: AsyncSession,
    *,
    document_type: str | None,
    q: str | None,
    date_from: date | None,
    date_to: date | None,
    customer_id: uuid.UUID | None,
    vehicle_no: str | None,
    statuses: str | None,
    lot_no: str | None,
    item_id: uuid.UUID | None,
    colour_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> tuple[list[DyeingDocumentListItem], int]:
    base = select(DyeingDocument)
    count_stmt = select(func.count(DyeingDocument.id))
    filters = []
    if document_type:
        filters.append(DyeingDocument.document_type == document_type)
    if q:
        like = f"%{q}%"
        filters.append(
            or_(
                DyeingDocument.challan_no.ilike(like),
                DyeingDocument.serial_no.ilike(like),
                DyeingDocument.vehicle_no.ilike(like),
                DyeingDocument.remarks.ilike(like),
            )
        )
    if date_from:
        filters.append(DyeingDocument.document_date >= date_from)
    if date_to:
        filters.append(DyeingDocument.document_date <= date_to)
    if customer_id:
        filters.append(DyeingDocument.customer_id == customer_id)
    if vehicle_no:
        filters.append(DyeingDocument.vehicle_no.ilike(f"%{vehicle_no}%"))
    if statuses:
        filters.append(DyeingDocument.status.in_([s.strip() for s in statuses.split(",")]))

    # Item-scoped filters require a join to items.
    join_items = bool(lot_no or item_id or colour_id)
    if join_items:
        base = base.join(DyeingDocumentItem, DyeingDocumentItem.dyeing_document_id == DyeingDocument.id)
        count_stmt = select(func.count(func.distinct(DyeingDocument.id))).join(
            DyeingDocumentItem, DyeingDocumentItem.dyeing_document_id == DyeingDocument.id
        )
        if lot_no:
            filters.append(DyeingDocumentItem.lot_no.ilike(f"%{lot_no}%"))
        if item_id:
            filters.append(DyeingDocumentItem.item_id == item_id)
        if colour_id:
            filters.append(DyeingDocumentItem.colour_id == colour_id)

    if filters:
        base = base.where(*filters)
        count_stmt = count_stmt.where(*filters)

    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        base.order_by(DyeingDocument.document_date.desc(), DyeingDocument.created_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
        .distinct()
    )
    rows = (await db.execute(stmt)).scalars().unique().all()

    if not rows:
        return [], total

    customer_names: dict[uuid.UUID, str] = {}
    cust_ids = {d.customer_id for d in rows if d.customer_id}
    if cust_ids:
        res = await db.execute(select(Customer).where(Customer.id.in_(cust_ids)))
        customer_names = {c.id: c.name for c in res.scalars().all()}

    items_out: list[DyeingDocumentListItem] = []
    for d in rows:
        items_out.append(
            DyeingDocumentListItem(
                id=d.id,
                document_type=d.document_type,
                challan_no=d.challan_no,
                serial_no=d.serial_no,
                document_date=d.document_date,
                status=d.status,
                customer=RefRead(id=d.customer_id, name=customer_names[d.customer_id])
                if d.customer_id and d.customer_id in customer_names
                else None,
                vehicle_no=d.vehicle_no,
                remarks=d.remarks,
                total_rolls=d.total_rolls,
                total_qty=d.total_qty,
                gross_amount=d.gross_amount,
                net_amount=d.net_amount,
                updated_at=d.updated_at,
            )
        )
    return items_out, total


async def filter_options(db: AsyncSession, document_type: str | None) -> dict[str, list[Any]]:
    base = select(DyeingDocument)
    scope = []
    if document_type:
        scope.append(DyeingDocument.document_type == document_type)

    customers = (
        await db.execute(select(Customer).order_by(Customer.name))
    ).scalars().all()
    colours = (await db.execute(select(Colour).order_by(Colour.name))).scalars().all()
    items = (await db.execute(select(Item).order_by(Item.name))).scalars().all()

    vehicle_stmt = (
        select(DyeingDocument.vehicle_no)
        .where(DyeingDocument.vehicle_no.is_not(None), *scope)
        .distinct()
        .order_by(DyeingDocument.vehicle_no)
    )
    vehicles = [v for (v,) in (await db.execute(vehicle_stmt)).all()]

    lot_stmt = (
        select(DyeingDocumentItem.lot_no)
        .join(DyeingDocument, DyeingDocumentItem.dyeing_document_id == DyeingDocument.id)
        .where(DyeingDocumentItem.lot_no.is_not(None), *scope)
        .distinct()
        .order_by(DyeingDocumentItem.lot_no)
    )
    lots = [l for (l,) in (await db.execute(lot_stmt)).all()]

    return {
        "customers": [{"id": c.id, "name": c.name} for c in customers],
        "items": [{"id": c.id, "name": c.name} for c in items],
        "colours": [{"id": c.id, "name": c.name} for c in colours],
        "vehicleNos": vehicles,
        "lotNos": lots,
        "statuses": ["draft", "saved"],
        "documentTypes": list(DOCUMENT_TYPES),
    }