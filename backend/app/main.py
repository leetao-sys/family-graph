import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .db import engine
from .routers import admin, articles, auth, graph, history, notifications, persons, relationships
from .seed import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("DB_AUTO_INIT", "true") == "true":
        init_db()
    yield


app = FastAPI(
    title="家族关系图谱系统 API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # 会话放在 HttpOnly Cookie 中；写操作要求自定义请求头，跨站表单无法伪造（CSRF 防护）
    if (
        request.method not in SAFE_METHODS
        and request.url.path.startswith("/api/")
        and request.headers.get("x-requested-with") != "family-graph"
    ):
        return JSONResponse({"detail": "缺少请求头 X-Requested-With"}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.url.path.startswith("/api/") and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


for r in (auth.router, persons.router, relationships.router, graph.router, history.router, admin.router,
          articles.router, notifications.router):
    app.include_router(r)


@app.get("/api/health", tags=["系统"])
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}
