from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException, Request

from .. import auth
from ..config import APP_TITLE, APP_VERSION, PORT
from ..data_service import RAW_DISPLAY_HEADERS
from ..dependencies import (
    activity_log_service,
    auth_service,
    data_service,
    json_error,
    logger,
    reload_core_services,
    user_admin_service,
)

router = APIRouter()


def _parse_bool_flag(value: str | bool | None, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default

    text = str(value).strip().lower()
    if text in {"1", "true", "y", "yes", "on"}:
        return True
    if text in {"0", "false", "n", "no", "off"}:
        return False
    return default


def _get_client_ip(request: Request) -> str:
    try:
        if request.client and request.client.host:
            return str(request.client.host)
    except Exception:
        pass
    return ""


@router.get("/health")
def health():
    meta = data_service.bundle.to_meta()
    loaded = bool(meta.get("record_count", 0))

    return {
        "status": "ok",
        "app_name": APP_TITLE,
        "version": APP_VERSION,
        "port": PORT,
        "data_loaded": loaded,
        "record_count": meta.get("record_count", 0),
        "base_date": meta.get("base_date", ""),
        "loaded_at": meta.get("loaded_at", ""),
        "user_count": auth_service.get_user_count(),
    }


@router.get("/me")
def me(request: Request):
    try:
        return {"user": auth.require_user(request)}
    except Exception:
        logger.exception("/me 조회 실패")
        raise HTTPException(status_code=401, detail="인증 정보가 유효하지 않습니다.")


@router.get("/dashboard-data")
def dashboard_data(request: Request):
    try:
        user = auth.require_user(request)
        records = data_service.get_scoped_records(user)

        return {
            "ok": True,
            "meta": data_service.bundle.to_meta(),
            "headers": RAW_DISPLAY_HEADERS,
            "partner_alias_map": data_service.bundle.partner_alias_map,
            "user": user,
            "records": records,
        }

    except Exception as exc:
        logger.exception("/dashboard-data 조회 실패")
        return json_error(
            message="대시보드 데이터 조회에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.get("/stage-data")
def stage_data(request: Request):
    try:
        user = auth.require_user(request)
        records = data_service.get_scoped_records(user)

        return {
            "ok": True,
            "meta": data_service.bundle.to_meta(),
            "partner_alias_map": data_service.bundle.partner_alias_map,
            "user": user,
            "records": records,
        }

    except Exception as exc:
        logger.exception("/stage-data 조회 실패")
        return json_error(
            message="Stage 데이터 조회에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.post("/reload-data")
def reload_data(request: Request, base_date: str = Form(default="")):
    try:
        admin_user = auth.require_manager(request)
        bundle = reload_core_services(base_date_text=base_date or None)

        try:
            activity_log_service.log_event(
                event_type="reload_data",
                actor_user_id=admin_user.get("id"),
                target_user_id=None,
                result="success",
                detail=f"기준일={bundle.to_meta().get('base_date', '')}",
                ip_address=_get_client_ip(request),
            )
        except Exception:
            logger.exception("데이터 재로드 로그 기록 실패")

        logger.info(
            "데이터 재로드 완료 | base_date=%s | record_count=%s | user_count=%s",
            bundle.to_meta().get("base_date", ""),
            bundle.to_meta().get("record_count", 0),
            auth_service.get_user_count(),
        )

        return {
            "ok": True,
            "message": "데이터를 다시 불러왔습니다.",
            "meta": bundle.to_meta(),
        }

    except Exception as exc:
        logger.exception("/reload-data 실패")
        return json_error(
            message="데이터 재로드에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.get("/admin/users")
def admin_users(request: Request, search: str = "", role: str = "all", active: str = "all"):
    try:
        auth.require_admin(request)

        users = user_admin_service.list_users(
            search=search,
            role=role,
            active=active,
        )

        return {
            "ok": True,
            "users": users,
            "count": len(users),
        }

    except Exception as exc:
        logger.exception("/admin/users 조회 실패")
        return json_error(
            message="사용자 목록 조회에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.post("/admin/users")
def create_admin_user(
    request: Request,
    user_id: str = Form(...),
    password: str = Form(...),
    name: str = Form(default=""),
    role: str = Form(...),
    partner: str = Form(default=""),
    is_active: str = Form(default="true"),
):
    try:
        admin_user = auth.require_admin(request)

        created = user_admin_service.create_user(
            user_id=user_id,
            password=password,
            name=name,
            role=role,
            partner=partner,
            is_active=_parse_bool_flag(is_active, default=True),
        )

        auth_service.reload_users()

        try:
            activity_log_service.log_event(
                event_type="create_user",
                actor_user_id=admin_user.get("id"),
                target_user_id=created.get("user_id"),
                result="success",
                detail=f"role={created.get('role', '')}, active={created.get('is_active', False)}",
                ip_address=_get_client_ip(request),
            )
        except Exception:
            logger.exception("사용자 생성 로그 기록 실패")

        logger.info("사용자 생성 완료 | user_id=%s", created.get("user_id", ""))

        return {
            "ok": True,
            "message": "사용자를 생성했습니다.",
            "user": {
                "user_id": created.get("user_id", ""),
                "name": created.get("name", ""),
                "role": created.get("role", ""),
                "partner": created.get("partner"),
                "is_active": created.get("is_active", False),
            },
        }

    except ValueError as exc:
        return json_error(
            message="사용자 생성에 실패했습니다.",
            status_code=400,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("/admin/users 생성 실패")
        return json_error(
            message="사용자 생성에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.put("/admin/users/{user_id}")
def update_admin_user(
    request: Request,
    user_id: str,
    password: str = Form(default=""),
    name: str = Form(default=""),
    role: str = Form(...),
    partner: str = Form(default=""),
    is_active: str = Form(default="true"),
):
    try:
        current_user = auth.require_admin(request)
        current_user_id = str(current_user.get("id", "")).strip().lower()
        target_user_id = str(user_id).strip().lower()

        normalized_role = str(role).strip().lower()
        normalized_is_active = _parse_bool_flag(is_active, default=True)

        if target_user_id == current_user_id:
            if not normalized_is_active:
                return json_error(
                    message="본인 계정은 비활성화할 수 없습니다.",
                    status_code=400,
                    detail="현재 로그인한 관리자 계정은 활성 상태를 유지해야 합니다.",
                )
            if normalized_role != "admin":
                return json_error(
                    message="본인 계정 권한은 admin 으로 유지해야 합니다.",
                    status_code=400,
                    detail="현재 로그인한 관리자 계정의 권한 강등은 허용하지 않습니다.",
                )

        updated = user_admin_service.update_user(
            user_id=target_user_id,
            password=password,
            name=name,
            role=role,
            partner=partner,
            is_active=normalized_is_active,
        )

        auth_service.reload_users()

        try:
            detail_parts = [
                f"role={updated.get('role', '')}",
                f"active={updated.get('is_active', False)}",
            ]
            if str(password or "").strip():
                detail_parts.append("password=changed")

            activity_log_service.log_event(
                event_type="update_user",
                actor_user_id=current_user.get("id"),
                target_user_id=target_user_id,
                result="success",
                detail=", ".join(detail_parts),
                ip_address=_get_client_ip(request),
            )
        except Exception:
            logger.exception("사용자 수정 로그 기록 실패")

        logger.info("사용자 수정 완료 | user_id=%s", target_user_id)

        return {
            "ok": True,
            "message": "사용자 정보를 수정했습니다.",
            "user": {
                "user_id": updated.get("user_id", ""),
                "name": updated.get("name", ""),
                "role": updated.get("role", ""),
                "partner": updated.get("partner"),
                "is_active": updated.get("is_active", False),
            },
        }

    except ValueError as exc:
        return json_error(
            message="사용자 수정에 실패했습니다.",
            status_code=400,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("/admin/users 수정 실패")
        return json_error(
            message="사용자 수정에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.patch("/admin/users/{user_id}/active")
def set_admin_user_active(
    request: Request,
    user_id: str,
    is_active: str = Form(...),
):
    try:
        current_user = auth.require_admin(request)
        current_user_id = str(current_user.get("id", "")).strip().lower()
        target_user_id = str(user_id).strip().lower()
        normalized_is_active = _parse_bool_flag(is_active, default=True)

        if target_user_id == current_user_id and not normalized_is_active:
            return json_error(
                message="본인 계정은 비활성화할 수 없습니다.",
                status_code=400,
                detail="현재 로그인한 관리자 계정은 활성 상태를 유지해야 합니다.",
            )

        updated = user_admin_service.set_user_active(
            user_id=target_user_id,
            is_active=normalized_is_active,
        )

        auth_service.reload_users()

        try:
            activity_log_service.log_event(
                event_type="set_user_active",
                actor_user_id=current_user.get("id"),
                target_user_id=target_user_id,
                result="success",
                detail=f"is_active={normalized_is_active}",
                ip_address=_get_client_ip(request),
            )
        except Exception:
            logger.exception("사용자 활성상태 변경 로그 기록 실패")

        logger.info(
            "사용자 활성상태 변경 완료 | user_id=%s | is_active=%s",
            target_user_id,
            normalized_is_active,
        )

        return {
            "ok": True,
            "message": "활성 상태를 변경했습니다.",
            "user": {
                "user_id": updated.get("user_id", ""),
                "is_active": updated.get("is_active", False),
            },
        }

    except ValueError as exc:
        return json_error(
            message="활성 상태 변경에 실패했습니다.",
            status_code=400,
            detail=str(exc),
        )
    except Exception as exc:
        logger.exception("/admin/users/{user_id}/active 실패")
        return json_error(
            message="활성 상태 변경에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.post("/account/change-password")
def change_my_password(
    request: Request,
    current_password: str = Form(...),
    new_password: str = Form(...),
    new_password_confirm: str = Form(...),
):
    try:
        current_user = auth.require_user(request)
        current_user_id = str(current_user.get("id", "")).strip().lower()

        if not str(current_password or "").strip():
            return json_error(
                message="비밀번호 변경에 실패했습니다.",
                status_code=400,
                detail="현재 비밀번호를 입력해야 합니다.",
            )

        if not str(new_password or "").strip():
            return json_error(
                message="비밀번호 변경에 실패했습니다.",
                status_code=400,
                detail="새 비밀번호를 입력해야 합니다.",
            )

        if str(new_password) != str(new_password_confirm):
            return json_error(
                message="비밀번호 변경에 실패했습니다.",
                status_code=400,
                detail="새 비밀번호 확인이 일치하지 않습니다.",
            )

        if str(current_password) == str(new_password):
            return json_error(
                message="비밀번호 변경에 실패했습니다.",
                status_code=400,
                detail="현재 비밀번호와 다른 새 비밀번호를 입력해야 합니다.",
            )

        if not user_admin_service.verify_user_password(current_user_id, current_password):
            try:
                activity_log_service.log_event(
                    event_type="change_password",
                    actor_user_id=current_user_id,
                    target_user_id=current_user_id,
                    result="failed",
                    detail="현재 비밀번호 불일치",
                    ip_address=_get_client_ip(request),
                )
            except Exception:
                logger.exception("비밀번호 변경 실패 로그 기록 실패")

            return json_error(
                message="비밀번호 변경에 실패했습니다.",
                status_code=400,
                detail="현재 비밀번호가 올바르지 않습니다.",
            )

        user_admin_service.change_password(current_user_id, new_password)
        auth_service.reload_users()

        try:
            activity_log_service.log_event(
                event_type="change_password",
                actor_user_id=current_user_id,
                target_user_id=current_user_id,
                result="success",
                detail="본인 비밀번호 변경",
                ip_address=_get_client_ip(request),
            )
        except Exception:
            logger.exception("비밀번호 변경 성공 로그 기록 실패")

        return {
            "ok": True,
            "message": "비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하면 됩니다.",
        }

    except Exception as exc:
        logger.exception("/account/change-password 실패")
        return json_error(
            message="비밀번호 변경에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )


@router.get("/admin/activity-logs")
def admin_activity_logs(
    request: Request,
    search: str = "",
    event_type: str = "all",
    result: str = "all",
    limit: int = 300,
):
    try:
        auth.require_admin(request)

        logs = activity_log_service.list_logs(
            search=search,
            event_type=event_type,
            result=result,
            limit=limit,
        )

        return {
            "ok": True,
            "logs": logs,
            "count": len(logs),
        }

    except Exception as exc:
        logger.exception("/admin/activity-logs 조회 실패")
        return json_error(
            message="활동 로그 조회에 실패했습니다.",
            status_code=500,
            detail=str(exc),
        )