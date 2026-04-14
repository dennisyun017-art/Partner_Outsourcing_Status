from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

from .config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL


class ActivityLogService:
    def __init__(self) -> None:
        if not SUPABASE_URL:
            raise ValueError("SUPABASE_URL 이 비어 있습니다.")
        if not SUPABASE_SERVICE_ROLE_KEY:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY 가 비어 있습니다.")

        self.client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    @staticmethod
    def _normalize_user_id(value: Any) -> str | None:
        text = str(value or "").strip().lower()
        return text or None

    @staticmethod
    def _normalize_text(value: Any) -> str | None:
        text = str(value or "").strip()
        return text or None

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

    def log_event(
        self,
        event_type: str,
        actor_user_id: str | None = None,
        target_user_id: str | None = None,
        result: str = "success",
        detail: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        payload = {
            "event_type": self._normalize_text(event_type) or "unknown",
            "actor_user_id": self._normalize_user_id(actor_user_id),
            "target_user_id": self._normalize_user_id(target_user_id),
            "result": self._normalize_text(result) or "success",
            "detail": self._normalize_text(detail),
            "ip_address": self._normalize_text(ip_address),
        }

        self.client.table("user_activity_logs").insert(payload).execute()

    def list_logs(
        self,
        search: str = "",
        event_type: str = "all",
        result: str = "all",
        limit: int = 300,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 300), 1000))

        response = (
            self.client
            .table("user_activity_logs")
            .select("*")
            .order("created_at", desc=True)
            .limit(safe_limit)
            .execute()
        )

        rows = response.data or []
        normalized_search = str(search or "").strip().lower()
        normalized_event_type = str(event_type or "all").strip().lower()
        normalized_result = str(result or "all").strip().lower()

        result_rows: list[dict[str, Any]] = []

        for row in rows:
            item = {
                "id": row.get("id"),
                "event_type": str(row.get("event_type", "") or ""),
                "actor_user_id": str(row.get("actor_user_id", "") or ""),
                "target_user_id": str(row.get("target_user_id", "") or ""),
                "result": str(row.get("result", "") or ""),
                "detail": str(row.get("detail", "") or ""),
                "ip_address": str(row.get("ip_address", "") or ""),
                "created_at": self._format_timestamp(row.get("created_at")),
            }

            if normalized_event_type not in {"", "all"} and item["event_type"].lower() != normalized_event_type:
                continue

            if normalized_result not in {"", "all"} and item["result"].lower() != normalized_result:
                continue

            if normalized_search:
                haystack = " ".join([
                    item["event_type"],
                    item["actor_user_id"],
                    item["target_user_id"],
                    item["result"],
                    item["detail"],
                    item["ip_address"],
                ]).lower()
                if normalized_search not in haystack:
                    continue

            result_rows.append(item)

        return result_rows