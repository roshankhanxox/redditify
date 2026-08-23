import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import admin, assets, auth, backgrounds, jobs, quota


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

app.include_router(assets.router)
app.include_router(backgrounds.router)
app.include_router(quota.router)
app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(admin.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
