from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from supabase import Client, create_client

from .config import (
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
    USERS_JSON_PATH,
)

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, users_json_path: Path = USERS_JSON_PATH) -> None:
        self.users_json_path = users_json_path
        self.users: dict[str, dict[str, Any]] = {}
        self.source_name = ""

        self.client: Client | None = None
        self.use_supabase = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

        if self.use_supabase:
            self.client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    @staticmethod
    def find_users_json_file(path: Path) -> Path | None:
        if path.exists() and path.is_file():
            return path
        return None

    @staticmethod
    def _normalize_role(role_value: Any) -> str:
        role = str(role_value or "").strip().lower()
        if role == "vendor":
            role = "partner"
        return role

    @classmethod
    def _normalize_user_record(cls, info: dict[str, Any]) -> dict[str, Any]:
        role = cls._normalize_role(info.get("role", ""))

        partner_value = info.get("partner")
        if partner_value is None:
            partner_value = info.get("vendor")

        is_active_value = info.get("is_active", True)
        if isinstance(is_active_value, str):
            is_active = is_active_value.strip().lower() in {"1", "true", "y", "yes", "on"}
        else:
            is_active = bool(is_active_value)

        return {
            "password": str(info.get("password", "")),
            "role": role,
            "partner": partner_value,
            "name": str(info.get("name", "")),
            "is_active": is_active,
        }

    @classmethod
    def load_users_from_json(cls, path: Path) -> dict[str, dict[str, Any]]:
        with open(path, "r", encoding="utf-8") as file:
            data = json.load(file)

        normalized: dict[str, dict[str, Any]] = {}
        for user_id, info in data.items():
            normalized_user_id = str(user_id).strip().lower()
            if not normalized_user_id:
                continue
            normalized[normalized_user_id] = cls._normalize_user_record(info)

        return normalized

    def _fetch_all_supabase_users(self) -> list[dict[str, Any]]:
        if self.client is None:
            raise RuntimeError("Supabase client 가 초기화되지 않았습니다.")

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

    def _fetch_supabase_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        if self.client is None:
            raise RuntimeError("Supabase client 가 초기화되지 않았습니다.")

        normalized_user_id = str(user_id or "").strip().lower()
        if not normalized_user_id:
            return None

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

    @classmethod
    def _normalize_supabase_users(cls, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        normalized: dict[str, dict[str, Any]] = {}

        for row in rows:
            user_id = str(row.get("user_id", "")).strip().lower()
            if not user_id:
                continue
            normalized[user_id] = cls._normalize_user_record(row)

        return normalized

    def load_users_from_supabase(self) -> dict[str, dict[str, Any]]:
        rows = self._fetch_all_supabase_users()
        return self._normalize_supabase_users(rows)

    def reload_users(self) -> dict[str, dict[str, Any]]:
        if self.use_supabase:
            self.users = self.load_users_from_supabase()
            self.source_name = "supabase:users"
            logger.info("Auth users reload from Supabase | count=%s", len(self.users))
            return self.users

        users_path = self.find_users_json_file(self.users_json_path)
        if users_path is None:
            raise FileNotFoundError(f"users.json 파일이 없습니다: {self.users_json_path}")

        self.users = self.load_users_from_json(users_path)
        self.source_name = str(users_path)
        logger.info("Auth users reload from JSON | count=%s | path=%s", len(self.users), self.source_name)
        return self.users

    def validate_login(self, user_id: str, password: str) -> dict[str, Any] | None:
        normalized_user_id = str(user_id or "").strip().lower()
        plain_password = str(password or "")

        # 로그인은 항상 Supabase 우선 기준
        if self.use_supabase:
            row = self._fetch_supabase_user_by_id(normalized_user_id)
            logger.info("LOGIN_CHECK | source=supabase | user_id=%s | row_found=%s", normalized_user_id, bool(row))

            if not row:
                return None

            user = self._normalize_user_record(row)
            logger.info(
                "LOGIN_USER_STATE | user_id=%s | is_active=%s | role=%s",
                normalized_user_id,
                user.get("is_active", True),
                user.get("role", ""),
            )

            if not user.get("is_active", True):
                logger.info("LOGIN_BLOCKED_INACTIVE | user_id=%s", normalized_user_id)
                return None

            if str(user.get("password", "")) != plain_password:
                logger.info("LOGIN_BLOCKED_PASSWORD | user_id=%s", normalized_user_id)
                return None

            logger.info("LOGIN_ALLOWED | user_id=%s", normalized_user_id)
            return {
                "id": normalized_user_id,
                "role": user.get("role", ""),
                "partner": user.get("partner"),
                "name": user.get("name", ""),
            }

        # fallback: JSON
        user = self.users.get(normalized_user_id)
        logger.info("LOGIN_CHECK | source=json | user_id=%s | row_found=%s", normalized_user_id, bool(user))

        if not user:
            return None

        if not bool(user.get("is_active", True)):
            logger.info("LOGIN_BLOCKED_INACTIVE | source=json | user_id=%s", normalized_user_id)
            return None

        if str(user.get("password", "")) != plain_password:
            logger.info("LOGIN_BLOCKED_PASSWORD | source=json | user_id=%s", normalized_user_id)
            return None

        logger.info("LOGIN_ALLOWED | source=json | user_id=%s", normalized_user_id)
        return {
            "id": normalized_user_id,
            "role": user.get("role", ""),
            "partner": user.get("partner"),
            "name": user.get("name", ""),
        }

    def is_user_active(self, user_id: str) -> bool:
        normalized_user_id = str(user_id or "").strip().lower()
        if not normalized_user_id:
            return False

        if self.use_supabase:
            row = self._fetch_supabase_user_by_id(normalized_user_id)
            if not row:
                logger.info("SESSION_ACTIVE_CHECK | user_id=%s | active=False | reason=not_found", normalized_user_id)
                return False

            user = self._normalize_user_record(row)
            active = bool(user.get("is_active", True))
            logger.info("SESSION_ACTIVE_CHECK | user_id=%s | active=%s", normalized_user_id, active)
            return active

        user = self.users.get(normalized_user_id)
        if not user:
            logger.info("SESSION_ACTIVE_CHECK | source=json | user_id=%s | active=False | reason=not_found", normalized_user_id)
            return False

        active = bool(user.get("is_active", True))
        logger.info("SESSION_ACTIVE_CHECK | source=json | user_id=%s | active=%s", normalized_user_id, active)
        return active

    def get_user_count(self) -> int:
        return len(self.users)

    def get_users_json_path_text(self) -> str:
        if self.source_name:
            return self.source_name
        if self.use_supabase:
            return "supabase:users"
        return str(self.users_json_path)