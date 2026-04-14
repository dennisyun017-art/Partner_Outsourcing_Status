from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .config import (
    APP_TITLE,
    HOST,
    PORT,
    SESSION_COOKIE_NAME,
    SESSION_SECRET_KEY,
    STATIC_DIR,
    ensure_directories,
)
from .dependencies import auth_service, data_service, logger, reload_core_services
from .routers import api, pages


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_directories()
    try:
        reload_core_services()
        logger.info(
            "초기 데이터 로드 완료 | record_count=%s | user_count=%s",
            data_service.bundle.to_meta().get("record_count", 0),
            auth_service.get_user_count(),
        )
    except Exception:
        logger.exception("초기 데이터 로드 실패")
    yield


app = FastAPI(title=APP_TITLE, lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET_KEY,
    session_cookie=SESSION_COOKIE_NAME,
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(pages.router)
app.include_router(api.router, prefix="/api")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)