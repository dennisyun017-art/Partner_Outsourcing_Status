from __future__ import annotations

import logging

from fastapi import Request, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from . import auth
from .activity_log_service import ActivityLogService
from .auth_service import AuthService
from .config import (
    APP_AUTHOR,
    APP_LAST_MODIFIED,
    APP_TITLE,
    APP_VERSION,
    TEMPLATES_DIR,
)
from .data_service import DashboardDataService
from .user_admin_service import UserAdminService


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

data_service = DashboardDataService()
auth_service = AuthService()
user_admin_service = UserAdminService()
activity_log_service = ActivityLogService()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


def reload_core_services(base_date_text: str | None = None):
    auth_service.reload_users()
    bundle = data_service.reload_all(
        base_date_text=base_date_text,
        users_json_path_text=auth_service.get_users_json_path_text(),
    )
    return bundle


def common_context(request: Request) -> dict:
    bundle = data_service.bundle
    return {
        "request": request,
        "app_title": APP_TITLE,
        "app_version": APP_VERSION,
        "app_last_modified": APP_LAST_MODIFIED,
        "app_author": APP_AUTHOR,
        "meta": bundle.to_meta(),
        "current_user": auth.get_current_user(request),
    }


def json_error(message: str, status_code: int = 500, detail: str | None = None) -> JSONResponse:
    payload = {
        "ok": False,
        "message": message,
    }
    if detail:
        payload["detail"] = detail
    return JSONResponse(status_code=status_code, content=payload)


def render_login_page(
    request: Request,
    error_message: str | None = None,
    status_code: int = status.HTTP_200_OK,
) -> HTMLResponse:
    context = common_context(request)
    if error_message:
        context["error_message"] = error_message
    return templates.TemplateResponse(
        name="login.html",
        context=context,
        status_code=status_code,
    )