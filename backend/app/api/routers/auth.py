from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas.auth import (
    AvatarUpdate,
    LoginRequest,
    PasswordChange,
    TokenResponse,
    UserRead,
    UserUpdate,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user, token = await auth_service.authenticate(db, body.email, body.password)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(user)


@router.patch("/users/me", response_model=UserRead)
async def update_profile(
    body: UserUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    changes = body.model_dump(exclude_unset=True)
    if "email" in changes and changes["email"].lower().strip() != user.email:
        exists = (
            await db.execute(select(User).where(User.email == changes["email"].lower().strip()))
        ).scalar_one_or_none()
        if exists is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already in use")
        user.email = changes["email"].lower().strip()
    if "name" in changes:
        user.name = changes["name"]
    if "phone" in changes:
        user.phone = changes["phone"]
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.put("/users/me/avatar", response_model=UserRead)
async def update_avatar(
    body: AvatarUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user.avatar_url = body.avatar_url
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.put("/users/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_my_password(
    body: PasswordChange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await auth_service.change_password(db, user, body.current_password, body.new_password)