from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

import pandas as pd
from supabase import Client, create_client

from .excel_source import DashboardInputPayload


class SupabaseDataSource:
    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        page_size: int = 1000,
    ) -> None:
        if not supabase_url:
            raise ValueError("SUPABASE_URL 이 비어 있습니다.")
        if not supabase_key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY 가 비어 있습니다.")

        self.client: Client = create_client(supabase_url, supabase_key)
        self.page_size = page_size

    def load_dashboard_inputs(self) -> DashboardInputPayload:
        raw_df = self.load_mps_dataframe()
        partner_alias_map = self.load_partner_master()
        holidays = self.load_holidays()

        return DashboardInputPayload(
            raw_df=raw_df,
            partner_alias_map=partner_alias_map,
            holidays=holidays,
            raw_path="supabase:mps_records",
            partner_master_path="supabase:partner_master",
            source_name="supabase",
        )

    def _fetch_all(
        self,
        table_name: str,
        order_by: str | None = None,
        ascending: bool = True,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start = 0

        while True:
            end = start + self.page_size - 1

            query = self.client.table(table_name).select("*")

            if filters:
                for key, value in filters.items():
                    query = query.eq(key, value)

            if order_by:
                query = query.order(order_by, desc=not ascending)

            response = query.range(start, end).execute()
            batch = response.data or []

            if not batch:
                break

            rows.extend(batch)

            if len(batch) < self.page_size:
                break

            start += self.page_size

        return rows

    def load_mps_dataframe(self) -> pd.DataFrame:
        rows = self._fetch_all(
            table_name="mps_records",
            order_by="id",
            ascending=True,
            filters={"is_active": True},
        )

        df = pd.DataFrame(rows)

        if df.empty:
            return pd.DataFrame()

        rename_map = {
            "lot": "Lot",
            "code": "CODE",
            "wo": "WO",
            "serial_no": "S/N",
            "customer": "Customer",
            "line": "Line",
            "model": "Model",
            "fsc": "FSC",
            "efem": "EFEM",
            "tm": "TM",
            "pm": "PM",
            "su": "SU",
            "harness": "Harness",
            "stage": "Stage",
            "tuning": "Tuning",
            "production_start_date": "생산시작일",
            "tuning_start_date": "Tuning시작일",
            "production_end_date": "생산완료일",
            "remark": "Remark",
        }

        df = df.rename(columns=rename_map)

        # 문자열 컬럼은 Excel 읽기와 비슷하게 맞춰두는 편이 안전함
        text_cols = [
            "Lot", "CODE", "WO", "S/N", "Customer", "Line", "Model", "FSC",
            "EFEM", "TM", "PM", "SU", "Harness", "Stage", "Tuning", "Remark"
        ]

        for col in text_cols:
            if col not in df.columns:
                df[col] = ""
            df[col] = df[col].where(df[col].notna(), "")

        return df

    def load_partner_master(self) -> dict[str, list[str]]:
        rows = self._fetch_all(
            table_name="partner_master",
            order_by="id",
            ascending=True,
        )

        if not rows:
            return {}

        df = pd.DataFrame(rows)
        df.columns = [str(c).strip() for c in df.columns]

        required_cols = ["partner_id", "partner_name_ko", "partner_name_en", "alias", "use_yn"]
        missing = [c for c in required_cols if c not in df.columns]
        if missing:
            raise ValueError(
                "partner_master 필수 컬럼 누락: " + ", ".join(missing)
            )

        partner_alias_map: dict[str, list[str]] = {}

        for _, row in df.iterrows():
            use_yn = str(row.get("use_yn", "")).strip().upper()
            if use_yn != "Y":
                continue

            partner_name_ko = str(row.get("partner_name_ko", "")).strip()
            partner_name_en = str(row.get("partner_name_en", "")).strip()
            alias_text = str(row.get("alias", "")).strip()

            aliases = set(self.split_aliases(alias_text))

            if partner_name_ko:
                aliases.add(self.normalize_text(partner_name_ko))
            if partner_name_en:
                aliases.add(self.normalize_text(partner_name_en))

            if partner_name_ko:
                partner_alias_map[partner_name_ko] = sorted(a for a in aliases if a)

        if "금송" not in partner_alias_map:
            partner_alias_map["금송"] = sorted({
                self.normalize_text("금송"),
                self.normalize_text("Geumsong"),
            })

        return partner_alias_map

    def load_holidays(self) -> set[date]:
        rows = self._fetch_all(
            table_name="holidays",
            order_by="holiday_date",
            ascending=True,
        )

        holidays: set[date] = set()

        for row in rows:
            parsed = self.parse_date(row.get("holiday_date"))
            if parsed:
                holidays.add(parsed.date())

        return holidays

    @staticmethod
    def parse_date(value: Any) -> datetime | None:
        if value is None:
            return None

        try:
            if pd.isna(value):
                return None
        except Exception:
            pass

        if value is pd.NaT:
            return None

        if isinstance(value, pd.Timestamp):
            return value.to_pydatetime().replace(hour=0, minute=0, second=0, microsecond=0)

        if isinstance(value, datetime):
            return value.replace(hour=0, minute=0, second=0, microsecond=0)

        if isinstance(value, date):
            return datetime.combine(value, datetime.min.time())

        text = str(value).strip()
        if not text or text.lower() in {"nan", "none", "nat"}:
            return None

        normalized = text.replace(".", "-").replace("/", "-")
        formats = ["%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y%m%d", "%Y-%m"]

        for fmt in formats:
            try:
                parsed = datetime.strptime(normalized, fmt)
                return parsed.replace(hour=0, minute=0, second=0, microsecond=0)
            except Exception:
                pass

        try:
            parsed = pd.to_datetime(text, errors="coerce")
            if pd.isna(parsed):
                return None
            return parsed.to_pydatetime().replace(hour=0, minute=0, second=0, microsecond=0)
        except Exception:
            return None

    @staticmethod
    def normalize_text(value: Any) -> str:
        if value is None:
            return ""
        text = str(value).strip().lower()
        return re.sub(r"[^0-9a-zA-Z가-힣]+", "", text)

    @classmethod
    def split_aliases(cls, alias_text: Any) -> list[str]:
        if alias_text is None:
            return []
        return [cls.normalize_text(x) for x in str(alias_text).split(",") if str(x).strip()]