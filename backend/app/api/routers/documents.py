import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas.document import (
    DyeingDocumentCreate,
    DyeingDocumentListResp,
    DyeingDocumentRead,
    DyeingDocumentUpdate,
    DyeingItemRead,
)
from app.services import document_service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DyeingDocumentRead, status_code=status.HTTP_201_CREATED)
async def create_document(
    body: DyeingDocumentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DyeingDocumentRead:
    doc = await document_service.create_document(db, body, user.id)
    return await document_service.build_document_read(db, doc)


@router.get("", response_model=DyeingDocumentListResp)
async def list_documents(
    documentType: str | None = None,
    q: str | None = None,
    dateFrom: date | None = None,
    dateTo: date | None = None,
    customer: uuid.UUID | None = None,
    vehicleNo: str | None = None,
    status: str | None = None,
    lot: str | None = None,
    item: uuid.UUID | None = None,
    colour: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DyeingDocumentListResp:
    items, total = await document_service.list_documents(
        db,
        document_type=documentType,
        q=q,
        date_from=dateFrom,
        date_to=dateTo,
        customer_id=customer,
        vehicle_no=vehicleNo,
        statuses=status,
        lot_no=lot,
        item_id=item,
        colour_id=colour,
        page=page,
        page_size=pageSize,
    )
    return DyeingDocumentListResp(items=items, total=total, page=page, page_size=pageSize)


@router.get("/filter-options", response_model=dict)
async def filter_options(
    documentType: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    return await document_service.filter_options(db, documentType)


@router.get("/{document_id}/items", response_model=list[DyeingItemRead])
async def document_items(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[DyeingItemRead]:
    read = await document_service.build_document_read(db, await document_service.get_document(db, document_id))
    return read.items


@router.get("/{document_id}", response_model=DyeingDocumentRead)
async def get_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DyeingDocumentRead:
    doc = await document_service.get_document(db, document_id)
    return await document_service.build_document_read(db, doc)


@router.put("/{document_id}", response_model=DyeingDocumentRead)
async def update_document(
    document_id: uuid.UUID,
    body: DyeingDocumentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DyeingDocumentRead:
    doc = await document_service.get_document(db, document_id)
    updated = await document_service.update_document(db, doc, body, user.id)
    return await document_service.build_document_read(db, updated)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    await document_service.delete_document(db, document_id)