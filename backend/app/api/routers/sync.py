import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.schemas.auth import UserRead
from app.schemas.sync import (
    SyncHealthResponse,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
)
from app.services import sync_service

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/push", response_model=SyncPushResponse)
async def push(
    payload: SyncPushRequest,
    db: AsyncSession = Depends(get_db),
    _user: UserRead = Depends(get_current_user),
) -> SyncPushResponse:
    return SyncPushResponse(**(await sync_service.push(db, payload)))


@router.get("/pull", response_model=SyncPullResponse)
async def pull(
    since: datetime | None = Query(default=None, description="Return rows updated after this instant"),
    _user: UserRead = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SyncPullResponse:
    return SyncPullResponse(**(await sync_service.pull(db, since)))


@router.get("/health", response_model=SyncHealthResponse)
async def health() -> SyncHealthResponse:
    """Unauthenticated reachability probe used by devices to detect the network."""
    return SyncHealthResponse(status="ok", server_time=sync_service.utcnow())