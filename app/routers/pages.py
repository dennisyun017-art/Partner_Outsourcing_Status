from __future__ import annotations

from fastapi import APIRouter, Form, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse

from .. import auth
from ..dependencies import (
    activity_log_service,
    auth_service,
    common_context,
    logger,
    render_login_page,
    templates,
)

router = APIRouter()


def _get_client_ip(request: Request) -> str:
    try:
        if request.client and request.client.host:
            return str(request.client.host)
    except Exception:
        pass
    return ""


def _has_valid_session(request: Request) -> bool:
    try:
        auth.require_user(request)
        return True
    except Exception:
        auth.logout_user(request)
        return False


@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    if _has_valid_session(request):
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)
    return render_login_page(request)


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if _has_valid_session(request):
        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)
    return render_login_page(request)


@router.post("/login")
def login(request: Request, user_id: str = Form(...), password: str = Form(...)):
    client_ip = _get_client_ip(request)
    normalized_user_id = str(user_id or "").strip().lower()

    try:
        auth.logout_user(request)

        user = auth_service.validate_login(user_id, password)
        if not user:
            try:
                activity_log_service.log_event(
                    event_type="login",
                    actor_user_id=normalized_user_id,
                    target_user_id=normalized_user_id,
                    result="failed",
                    detail="로그인 실패",
                    ip_address=client_ip,
                )
            except Exception:
                logger.exception("로그인 실패 로그 기록 실패")

            return render_login_page(
                request=request,
                error_message="ID 또는 비밀번호가 올바르지 않습니다.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        auth.login_user(request, user)

        try:
            activity_log_service.log_event(
                event_type="login",
                actor_user_id=user.get("id"),
                target_user_id=user.get("id"),
                result="success",
                detail="로그인 성공",
                ip_address=client_ip,
            )
        except Exception:
            logger.exception("로그인 성공 로그 기록 실패")

        return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)

    except Exception:
        logger.exception("로그인 처리 중 오류 발생")
        try:
            activity_log_service.log_event(
                event_type="login",
                actor_user_id=normalized_user_id,
                target_user_id=normalized_user_id,
                result="error",
                detail="로그인 처리 중 서버 오류",
                ip_address=client_ip,
            )
        except Exception:
            logger.exception("로그인 오류 로그 기록 실패")

        return render_login_page(
            request=request,
            error_message="로그인 처리 중 오류가 발생했습니다.",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@router.post("/logout")
def logout(request: Request):
    current_user = auth.get_current_user(request)
    client_ip = _get_client_ip(request)

    try:
        if current_user:
            try:
                activity_log_service.log_event(
                    event_type="logout",
                    actor_user_id=current_user.get("id"),
                    target_user_id=current_user.get("id"),
                    result="success",
                    detail="로그아웃",
                    ip_address=client_ip,
                )
            except Exception:
                logger.exception("로그아웃 로그 기록 실패")
    finally:
        auth.logout_user(request)

    return RedirectResponse(url="/login", status_code=status.HTTP_302_FOUND)


@router.get("/dashboard", response_class=HTMLResponse)
def dashboard_page(request: Request):
    auth.require_user(request)
    return templates.TemplateResponse("dashboard.html", common_context(request))


@router.get("/stage", response_class=HTMLResponse)
def stage_page(request: Request):
    auth.require_user(request)
    return templates.TemplateResponse("stage_dashboard.html", common_context(request))


@router.get("/admin/users", response_class=HTMLResponse)
def admin_users_page(request: Request):
    auth.require_admin(request)
    return templates.TemplateResponse("admin_users.html", common_context(request))


@router.get("/account/password", response_class=HTMLResponse)
def account_password_page(request: Request):
    auth.require_user(request)
    return templates.TemplateResponse("account_password.html", common_context(request))


@router.get("/admin/logs", response_class=HTMLResponse)
def admin_logs_page(request: Request):
    auth.require_admin(request)
    return templates.TemplateResponse("admin_logs.html", common_context(request))