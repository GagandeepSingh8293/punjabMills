import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import get_db
from app.main import app
from app.models import Base, Colour, Customer, DyeingType, Item, User
from app.security import hash_password

TEST_DB_URL = "postgresql+psycopg://gagandeepsingh@localhost:5432/dyeai_test"

ADMIN_EMAIL = "admin@test.local"
ADMIN_PASSWORD = "Password123!"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DB_URL)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def seed_admin(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        session.add(
            User(
                name="Test Admin",
                email=ADMIN_EMAIL,
                role="Admin",
                password_hash=hash_password(ADMIN_PASSWORD),
            )
        )
        await session.commit()
    yield ADMIN_EMAIL, ADMIN_PASSWORD


@pytest_asyncio.fixture
async def client(engine, seed_admin):
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_headers(client) -> dict[str, str]:
    resp = await client.post(
        "/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest_asyncio.fixture
async def masters(client, auth_headers):
    """Create unique customer / item / dyeing-type / colour masters and return their ids."""
    suffix = uuid.uuid4().hex[:6]
    created: dict[str, str] = {}
    for kind, body in {
        "customers": {"name": f"Fixture Mills {suffix}", "state": "Punjab", "state_code": "03"},
        "items": {"name": f"Fixture Fabric {suffix}", "unit": "m"},
        "dyeing-types": {"name": f"Fixture Dyeing {suffix}"},
        "colours": {"name": f"Fixture Blue {suffix}", "hex": "#0000ff"},
    }.items():
        resp = await client.post(
            f"/masters/{kind}", json=body, headers=auth_headers
        )
        assert resp.status_code == 201, resp.text
        created[kind] = resp.json()["id"]
    return created