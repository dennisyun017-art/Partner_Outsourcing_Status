from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, status


SESSION_USER_KEY = "user"


def login_user(request: Request, user: dict[str, Any]) -> None:
    request.session[SESSION_USER_KEY] = user


def logout_user(request: Request) -> None:
    request.session.pop(SESSION_USER_KEY, None)


def get_current_user(request: Request) -> dict[str, Any] | None:
    user = request.session.get(SESSION_USER_KEY)
    if isinstance(user, dict):
        return user
    return None


def require_user(request: Request) -> dict[str, Any]:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")

    # 순환 import 방지용 지연 import
    from .dependencies import auth_service

    user_id = str(user.get("id", "")).strip().lower()

    # DB 기준 최신 active 상태 확인
    if not auth_service.is_user_active(user_id):
        logout_user(request)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="비활성화된 계정입니다. 관리자에게 문의하세요.",
        )

    return user


def require_admin(request: Request) -> dict[str, Any]:
    user = require_user(request)
    if str(user.get("role", "")).lower() != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
    return user

def require_manager(request: Request) -> dict[str, Any]:
    user = require_user(request)
    role = str(user.get("role", "")).lower()
    if role not in {"admin", "manager"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
    return user