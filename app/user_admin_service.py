from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

from .config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL


class UserAdminService:
    VALID_ROLES = {"admin", "partner"}

    def __init__(self) -> None:
        if not SUPABASE_URL:
            raise ValueError("SUPABASE_URL 이 비어 있습니다.")
        if not SUPABASE_SERVICE_ROLE_KEY:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY 가 비어 있습니다.")

        self.client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _normalize_user_id(user_id: Any) -> str:
        return str(user_id or "").strip().lower()

    @staticmethod
    def _normalize_role(role: Any) -> str:
        value = str(role or "").strip().lower()
        if value == "vendor":
            value = "partner"
        return value

    @staticmethod
    def _normalize_name(name: Any) -> str:
        return str(name or "").strip()

    @staticmethod
    def _normalize_partner(role: str, partner: Any) -> str | None:
        partner_text = str(partner or "").strip()
        if role == "partner" and not partner_text:
            raise ValueError("partner 권한 사용자는 협력사명을 입력해야 합니다.")
        if role == "admin" and not partner_text:
            return None
        return partner_text or None

    @staticmethod
    def _normalize_password(password: Any) -> str:
        return str(password or "").strip()

    @staticmethod
    def _format_timestamp(value: Any) -> str:
        if value is None:
            return ""

        text = str(value).strip()
        if not text:
            return ""

        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception:
            return text

    def _fetch_all_users_raw(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        start = 0

        while True:
            end = start + page_size - 1
            response = (
                self.client
                .table("users")
                .select("*")
                .order("id", desc=False)
                .range(start, end)
                .execute()
            )

            batch = response.data or []
            if not batch:
                break

            rows.extend(batch)

            if len(batch) < page_size:
                break

            start += page_size

        return rows

    def _get_user_row(self, user_id: str) -> dict[str, Any] | None:
        normalized_user_id = self._normalize_user_id(user_id)
        response = (
            self.client
            .table("users")
            .select("*")
            .eq("user_id", normalized_user_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            return None
        return rows[0]

    def list_users(
        self,
        search: str = "",
        role: str = "all",
        active: str = "all",
    ) -> list[dict[str, Any]]:
        rows = self._fetch_all_users_raw()

        normalized_search = str(search or "").strip().lower()
        normalized_role = self._normalize_role(role)
        normalized_active = str(active or "all").strip().lower()

        result: list[dict[str, Any]] = []

        for row in rows:
            item = {
                "user_id": self._normalize_user_id(row.get("user_id")),
                "name": self._normalize_name(row.get("name")),
                "role": self._normalize_role(row.get("role")),
                "partner": row.get("partner"),
                "is_active": bool(row.get("is_active", False)),
                "created_at": self._format_timestamp(row.get("created_at")),
                "updated_at": self._format_timestamp(row.get("updated_at")),
            }

            if normalized_role not in {"", "all"} and item["role"] != normalized_role:
                continue

            if normalized_active == "active" and not item["is_active"]:
                continue
            if normalized_active == "inactive" and item["is_active"]:
                continue

            if normalized_search:
                haystack = " ".join([
                    str(item["user_id"] or ""),
                    str(item["name"] or ""),
                    str(item["role"] or ""),
                    str(item["partner"] or ""),
                ]).lower()
                if normalized_search not in haystack:
                    continue

            result.append(item)

        result.sort(key=lambda x: (x["role"], x["user_id"]))
        return result

    def create_user(
        self,
        user_id: str,
        password: str,
        name: str,
        role: str,
        partner: str | None,
        is_active: bool,
    ) -> dict[str, Any]:
        normalized_user_id = self._normalize_user_id(user_id)
        normalized_password = self._normalize_password(password)
        normalized_name = self._normalize_name(name)
        normalized_role = self._normalize_role(role)

        if not normalized_user_id:
            raise ValueError("user_id 는 필수입니다.")
        if not normalized_password:
            raise ValueError("password 는 필수입니다.")
        if normalized_role not in self.VALID_ROLES:
            raise ValueError("role 값은 admin 또는 partner 만 가능합니다.")

        normalized_partner = self._normalize_partner(normalized_role, partner)

        exists = self._get_user_row(normalized_user_id)
        if exists:
            raise ValueError("이미 존재하는 user_id 입니다.")

        now_iso = self._utc_now_iso()

        payload = {
            "user_id": normalized_user_id,
            "password": normalized_password,
            "role": normalized_role,
            "partner": normalized_partner,
            "name": normalized_name,
            "is_active": bool(is_active),
            "created_at": now_iso,
            "updated_at": now_iso,
        }

        response = self.client.table("users").insert(payload).execute()
        rows = response.data or []
        if not rows:
            raise RuntimeError("사용자 생성 결과를 확인할 수 없습니다.")

        return rows[0]

    def update_user(
        self,
        user_id: str,
        password: str,
        name: str,
        role: str,
        partner: str | None,
        is_active: bool,
    ) -> dict[str, Any]:
        normalized_user_id = self._normalize_user_id(user_id)
        normalized_password = self._normalize_password(password)
        normalized_name = self._normalize_name(name)
        normalized_role = self._normalize_role(role)

        if not normalized_user_id:
            raise ValueError("수정할 user_id 가 비어 있습니다.")
        if normalized_role not in self.VALID_ROLES:
            raise ValueError("role 값은 admin 또는 partner 만 가능합니다.")

        exists = self._get_user_row(normalized_user_id)
        if not exists:
            raise ValueError("존재하지 않는 사용자입니다.")

        normalized_partner = self._normalize_partner(normalized_role, partner)

        payload = {
            "name": normalized_name,
            "role": normalized_role,
            "partner": normalized_partner,
            "is_active": bool(is_active),
            "updated_at": self._utc_now_iso(),
        }

        if normalized_password:
            payload["password"] = normalized_password

        response = (
            self.client
            .table("users")
            .update(payload)
            .eq("user_id", normalized_user_id)
            .execute()
        )

        rows = response.data or []
        if not rows:
            refreshed = self._get_user_row(normalized_user_id)
            if refreshed is None:
                raise RuntimeError("사용자 수정 결과를 확인할 수 없습니다.")
            return refreshed

        return rows[0]

    def set_user_active(self, user_id: str, is_active: bool) -> dict[str, Any]:
        normalized_user_id = self._normalize_user_id(user_id)
        if not normalized_user_id:
            raise ValueError("대상 user_id 가 비어 있습니다.")

        exists = self._get_user_row(normalized_user_id)
        if not exists:
            raise ValueError("존재하지 않는 사용자입니다.")

        response = (
            self.client
            .table("users")
            .update({
                "is_active": bool(is_active),
                "updated_at": self._utc_now_iso(),
            })
            .eq("user_id", normalized_user_id)
            .execute()
        )

        rows = response.data or []
        if not rows:
            refreshed = self._get_user_row(normalized_user_id)
            if refreshed is None:
                raise RuntimeError("활성 상태 변경 결과를 확인할 수 없습니다.")
            return refreshed

        return rows[0]

    def verify_user_password(self, user_id: str, password: str) -> bool:
        normalized_user_id = self._normalize_user_id(user_id)
        normalized_password = self._normalize_password(password)

        user = self._get_user_row(normalized_user_id)
        if not user:
            return False

        if not bool(user.get("is_active", False)):
            return False

        return str(user.get("password", "")) == normalized_password

    def change_password(self, user_id: str, new_password: str) -> dict[str, Any]:
        normalized_user_id = self._normalize_user_id(user_id)
        normalized_password = self._normalize_password(new_password)

        if not normalized_user_id:
            raise ValueError("대상 user_id 가 비어 있습니다.")
        if not normalized_password:
            raise ValueError("새 비밀번호는 필수입니다.")

        exists = self._get_user_row(normalized_user_id)
        if not exists:
            raise ValueError("존재하지 않는 사용자입니다.")

        response = (
            self.client
            .table("users")
            .update({
                "password": normalized_password,
                "updated_at": self._utc_now_iso(),
            })
            .eq("user_id", normalized_user_id)
            .execute()
        )

        rows = response.data or []
        if not rows:
            refreshed = self._get_user_row(normalized_user_id)
            if refreshed is None:
                raise RuntimeError("비밀번호 변경 결과를 확인할 수 없습니다.")
            return refreshed

        return rows[0]