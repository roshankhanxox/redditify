import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import assets, reddit


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="ReelBot API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reddit.router)
app.include_router(assets.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
