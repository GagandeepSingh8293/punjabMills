import uuid

from pydantic import BaseModel, ConfigDict


class RefRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    phone: str | None = None
    role: str
    avatar_url: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None


class AvatarUpdate(BaseModel):
    avatar_url: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead