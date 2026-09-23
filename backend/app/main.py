from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import auth, documents, masters, sync

app = FastAPI(
    title="DyeAI Backend",
    description="Dyeing RECEIPT / ISSUE document management API (PostgreSQL)",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(masters.router)
app.include_router(documents.router)
app.include_router(sync.router)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"ok": "true"}