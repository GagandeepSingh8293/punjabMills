import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    Category,
    Colour,
    ColourGroup,
    Customer,
    Depth,
    DyeingDocument,
    DyeingDocumentItem,
    DyeingType,
    HsnCode,
    Item,
    Process,
    SyncTombstone,
    TaxAccount,
)
from app.schemas.sync import SyncDocumentRow, SyncPushRequest
from app.services.document_service import _money, recalc

# Master tables the desktop app can push/pull (Postgres names as the wire keys).
MASTER_MODELS: dict[str, type] = {
    "customers": Customer,
    "colours": Colour,
    "depths": Depth,
    "processes": Process,
    "hsn_codes": HsnCode,
}

MASTER_REQUIRED: dict[str, list[str]] = {
    "customers": ["name"],
    "colours": ["name"],
    "depths": ["name"],
    "processes": ["name"],
    "hsn_codes": ["code"],
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _row_dict(row: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for c in row.__table__.columns:
        out[c.name] = getattr(row, c.name)
    return out


def _doc_item_dict(item: DyeingDocumentItem) -> dict[str, Any]:
    return {
        "line_no": item.line_no,
        "lot_no": item.lot_no,
        "item_id": item.item_id,
        "dyeing_type_id": item.dyeing_type_id,
        "colour_id": item.colour_id,
        "colour_group_id": item.colour_group_id,
        "process_id": item.process_id,
        "rolls": item.rolls,
        "quantity": item.quantity,
        "rate": item.rate,
        "amount": item.amount,
    }


def _doc_dict(doc: DyeingDocument) -> dict[str, Any]:
    return {
        "id": doc.id,
        "document_type": doc.document_type,
        "challan_no": doc.challan_no,
        "challan_date": doc.document_date,
        "serial_no": doc.serial_no,
        "document_date": doc.document_date,
        "status": doc.status,
        "customer_id": doc.customer_id,
        "category_id": doc.category_id,
        "tax_account_id": doc.tax_account_id,
        "vehicle_no": doc.vehicle_no,
        "through": doc.through,
        "through_dyeing": doc.through_dyeing,
        "remarks": doc.remarks,
        "issue_to_tubitor": doc.issue_to_tubitor,
        "issue_to_redyeing": doc.issue_to_redyeing,
        "non_paid": doc.non_paid,
        "redyeing_ref": doc.redyeing_ref,
        "tubitor_ref": doc.tubitor_ref,
        "eway_no": doc.eway_no,
        "shipping": doc.shipping,
        "round_off": doc.round_off,
        "total_rolls": doc.total_rolls,
        "total_qty": doc.total_qty,
        "gross_amount": doc.gross_amount,
        "net_amount": doc.net_amount,
        "updated_at": doc.updated_at,
        "raw_json": doc.raw_json,
        "items": [_doc_item_dict(i) for i in doc.items],
    }


async def _upsert_master(
    db: AsyncSession, kind: str, raw: dict[str, Any], conflicts: dict[str, list[dict]]
) -> None:
    model = MASTER_MODELS.get(kind)
    if model is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported master kind '{kind}'")
    row_id = raw.get("id")
    updated_at = raw.get("updated_at")
    if not row_id or updated_at is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "master rows need id + updated_at")
    updated_at = _as_aware(updated_at)

    existing = await db.get(model, row_id)
    if existing is not None and _as_aware(existing.updated_at) > updated_at:
        conflicts.setdefault(kind, []).append(_row_dict(existing))
        return

    cols = set(model.__table__.columns.keys())
    payload = {k: v for k, v in raw.items() if k in cols and k not in ("id", "created_at", "created_by", "updated_by")}
    for req in MASTER_REQUIRED.get(kind, []):
        if not payload.get(req):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"master row {kind} missing '{req}'")
    payload["updated_at"] = updated_at
    if "name" in cols and "name" not in payload and kind == "hsn_codes":
        payload["name"] = payload.get("code")
    if "active" in cols and "active" not in payload:
        payload["active"] = True

    stmt = pg_insert(model).values(id=row_id, **payload)
    set_cols = {c: getattr(stmt.excluded, c) for c in payload if c != "id"}
    stmt = stmt.on_conflict_do_update(index_elements=[model.__table__.c.id], set_=set_cols)
    try:
        await db.execute(stmt)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Master row {kind}/{row_id} conflicts with a unique field on the server",
        )


def _as_aware(value: datetime | None) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _null_unknown_fks(db: AsyncSession, row: SyncDocumentRow) -> None:
    """Sync must never lose a document: references we can't resolve are dropped
    (the raw_json keeps the original names for the app)."""
    for attr, model in (
        ("customer_id", Customer),
        ("category_id", Category),
        ("tax_account_id", TaxAccount),
    ):
        value = getattr(row, attr)
        if value is not None and await db.get(model, value) is None:
            setattr(row, attr, None)
    for item in row.items:
        for attr, model in (
            ("item_id", Item),
            ("dyeing_type_id", DyeingType),
            ("colour_id", Colour),
            ("colour_group_id", ColourGroup),
            ("process_id", Process),
        ):
            value = getattr(item, attr)
            if value is not None and await db.get(model, value) is None:
                setattr(item, attr, None)


def _docs_from_push(items: list[Any]) -> list[DyeingDocumentItem]:
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
            amount=_money(it.quantity * it.rate),
        )
        for it in items
    ]


async def _upsert_document(
    db: AsyncSession, row: SyncDocumentRow, conflicts: list[dict]
) -> str | None:
    """Returns an error message, or None on success."""
    await _null_unknown_fks(db, row)
    existing = await db.get(DyeingDocument, row.id)
    if existing is not None and _as_aware(existing.updated_at) > _as_aware(row.updated_at):
        result = await db.execute(
            select(DyeingDocument)
            .where(DyeingDocument.id == row.id)
            .options(selectinload(DyeingDocument.items))
        )
        server_doc = result.scalar_one()
        conflicts.append(_doc_dict(server_doc))
        return None

    totals = recalc(row.items)
    header = {
        "document_type": row.document_type,
        "challan_no": row.challan_no.strip(),
        "serial_no": row.serial_no,
        "document_date": row.challan_date,
        "status": row.status,
        "customer_id": row.customer_id,
        "category_id": row.category_id,
        "tax_account_id": row.tax_account_id,
        "vehicle_no": row.vehicle_no,
        "through": row.through,
        "through_dyeing": row.through_dyeing,
        "remarks": row.remarks,
        "issue_to_tubitor": row.issue_to_tubitor,
        "issue_to_redyeing": row.issue_to_redyeing,
        "non_paid": row.non_paid,
        "redyeing_ref": row.redyeing_ref,
        "tubitor_ref": row.tubitor_ref,
        "eway_no": row.eway_no,
        "shipping": row.shipping,
        "round_off": row.round_off,
        "total_rolls": totals["total_rolls"],
        "total_qty": totals["total_qty"],
        "gross_amount": totals["gross_amount"],
        "net_amount": _money(totals["gross_amount"] + row.round_off),
        "raw_json": row.raw_json,
        "updated_at": row.updated_at,
    }
    try:
        if existing is None:
            doc = DyeingDocument(id=row.id, **header)
            doc.items = _docs_from_push(row.items)
            db.add(doc)
        else:
            for k, v in header.items():
                setattr(existing, k, v)
            existing.items = _docs_from_push(row.items)
        await db.commit()
        return None
    except IntegrityError:
        await db.rollback()
        return f"Document {row.challan_no} conflicts with an existing challan on the server"


async def _apply_tombstones(db: AsyncSession, tombstones: list[Any], reply: dict) -> None:
    for t in tombstones:
        get = getattr(t, "get", None)
        if get is not None:
            table = get("table")
            row_id = get("row_id")
        else:
            table = t.table
            row_id = t.row_id
        if isinstance(row_id, str):
            try:
                row_id = uuid.UUID(row_id)
            except ValueError:
                row_id = None
        if row_id is None:
            continue
        if table == "challans":
            doc = await db.get(DyeingDocument, row_id)
            if doc is not None:
                await db.delete(doc)
            await db.execute(
                pg_insert(SyncTombstone)
                .values(table_name="challans", row_id=row_id)
                .on_conflict_do_nothing(index_elements=[SyncTombstone.table_name, SyncTombstone.row_id])
            )
            await db.commit()
            continue
        model = MASTER_MODELS.get(table)
        if model is None:
            reply.setdefault("errors", []).append(
                {"entity": table, "row_id": str(row_id), "message": "unknown table"}
            )
            continue
        row = await db.get(model, row_id)
        if row is None:
            await db.execute(
                pg_insert(SyncTombstone)
                .values(table_name=table, row_id=row_id)
                .on_conflict_do_nothing(index_elements=[SyncTombstone.table_name, SyncTombstone.row_id])
            )
            await db.commit()
            continue
        try:
            await db.delete(row)
            await db.execute(
                pg_insert(SyncTombstone)
                .values(table_name=table, row_id=row_id)
                .on_conflict_do_nothing(index_elements=[SyncTombstone.table_name, SyncTombstone.row_id])
            )
            await db.commit()
        except IntegrityError:
            await db.rollback()
            reply.setdefault("errors", []).append(
                {"entity": table, "row_id": str(row_id), "message": "server refuses delete (referenced)"}
            )


async def push(db: AsyncSession, req: SyncPushRequest) -> dict[str, Any]:
    reply: dict[str, Any] = {"masters": {}, "documents": [], "errors": []}
    try:
        for kind, rows in (req.masters or {}).items():
            for raw in rows:
                try:
                    await _upsert_master(db, kind, raw, reply["masters"])
                except HTTPException as e:
                    reply["errors"].append(
                        {"entity": kind, "row_id": str(raw.get("id", "")), "message": e.detail}
                    )
        for doc_row in req.documents or []:
            err = await _upsert_document(db, doc_row, reply["documents"])
            if err:
                reply["errors"].append({"entity": "challans", "row_id": str(doc_row.id), "message": err})
        await _apply_tombstones(db, req.tombstones or [], reply)
    except Exception as e:  # noqa: BLE001
        await db.rollback()
        reply["errors"].append({"entity": "batch", "row_id": "", "message": str(e)})
    return {"server_now": utcnow().isoformat(), **reply}


async def pull(db: AsyncSession, since: datetime | None) -> dict[str, Any]:
    since = _as_aware(since) if since else datetime.min.replace(tzinfo=timezone.utc)
    masters_out: dict[str, list[dict]] = {}
    for kind, model in MASTER_MODELS.items():
        rows = (
            (await db.execute(select(model).where(model.updated_at > since)))
            .scalars()
            .all()
        )
        masters_out[kind] = [_row_dict(r) for r in rows]

    docs_stmt = (
        select(DyeingDocument)
        .where(DyeingDocument.updated_at > since)
        .options(selectinload(DyeingDocument.items))
    )
    docs = (await db.execute(docs_stmt)).scalars().unique().all()
    documents = [_doc_dict(d) for d in docs]

    tombs = (
        (await db.execute(select(SyncTombstone).where(SyncTombstone.deleted_at > since)))
        .scalars()
        .all()
    )
    tombstones = [
        {"table": t.table_name, "row_id": t.row_id, "deleted_at": t.deleted_at} for t in tombs
    ]
    return {
        "server_now": utcnow().isoformat(),
        "masters": masters_out,
        "documents": documents,
        "tombstones": tombstones,
    }