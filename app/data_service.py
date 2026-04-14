from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd

from .config import (
    DATA_SOURCE,
    DATE_FMT,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
)
from .data_sources import ExcelDataSource, SupabaseDataSource


RAW_DISPLAY_HEADERS = [
    "Lot", "CODE", "WO", "S/N", "Customer", "Line", "Model", "FSC",
    "EFEM", "TM", "PM", "SU", "Harness", "Stage", "Tuning",
    "생산시작일", "Tuning시작일", "생산완료일", "Remark"
]


class DateHelper:
    @staticmethod
    def is_empty_date(value: Any) -> bool:
        if value is None:
            return True
        try:
            return bool(pd.isna(value))
        except Exception:
            return False

    @staticmethod
    def to_datetime(value: Any) -> datetime | None:
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
            try:
                if pd.isna(value):
                    return None
            except Exception:
                pass
            return value.to_pydatetime().replace(hour=0, minute=0, second=0, microsecond=0)

        if isinstance(value, datetime):
            return value.replace(hour=0, minute=0, second=0, microsecond=0)

        if isinstance(value, date):
            return datetime.combine(value, datetime.min.time())

        text = str(value).strip()
        if text == "":
            return None

        if text.lower() in {"nan", "none", "nat"}:
            return None

        normalized = text.replace(".", "-").replace("/", "-")

        formats = [
            "%Y-%m-%d",
            "%Y-%m-%d %H:%M:%S",
            "%Y%m%d",
            "%Y-%m",
        ]

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
            if isinstance(parsed, pd.Timestamp):
                return parsed.to_pydatetime().replace(hour=0, minute=0, second=0, microsecond=0)
        except Exception:
            return None

        return None

    @staticmethod
    def format_date(value: Any, fmt: str = DATE_FMT) -> str:
        if value is None:
            return ""

        try:
            if pd.isna(value):
                return ""
        except Exception:
            pass

        if value is pd.NaT:
            return ""

        if isinstance(value, pd.Timestamp):
            try:
                if pd.isna(value):
                    return ""
            except Exception:
                pass
            return value.to_pydatetime().strftime(fmt)

        if isinstance(value, datetime):
            return value.strftime(fmt)

        if isinstance(value, date):
            return datetime.combine(value, datetime.min.time()).strftime(fmt)

        return str(value)


@dataclass
class DataBundle:
    partner_alias_map: dict[str, list[str]] = field(default_factory=dict)
    holidays: set[date] = field(default_factory=set)
    df: pd.DataFrame = field(default_factory=pd.DataFrame)
    base_date: datetime | None = None
    loaded_at: datetime | None = None
    raw_path: str = ""
    partner_master_path: str = ""
    users_json_path: str = ""
    source_name: str = ""

    def to_meta(self) -> dict[str, Any]:
        return {
            "base_date": DateHelper.format_date(self.base_date, DATE_FMT),
            "loaded_at": DateHelper.format_date(self.loaded_at, "%Y-%m-%d %H:%M:%S"),
            "raw_path": self.raw_path,
            "partner_master_path": self.partner_master_path,
            "users_json_path": self.users_json_path,
            "source_name": self.source_name,
            "record_count": int(len(self.df)) if self.df is not None else 0,
        }


class DashboardDataService:
    DATE_COLUMNS = ["생산시작일", "Tuning시작일", "생산완료일"]

    def __init__(self, data_source: Any | None = None) -> None:
        self.bundle = DataBundle()
        self.data_source = data_source or self._build_default_source()

    @staticmethod
    def _build_default_source() -> Any:
        if DATA_SOURCE == "supabase":
            return SupabaseDataSource(
                supabase_url=SUPABASE_URL,
                supabase_key=SUPABASE_SERVICE_ROLE_KEY,
            )
        return ExcelDataSource()

    @staticmethod
    def _require_attr(obj: Any, attr_name: str) -> Any:
        if not hasattr(obj, attr_name):
            raise AttributeError(f"데이터 소스 payload에 '{attr_name}' 속성이 없습니다.")
        return getattr(obj, attr_name)

    def reload_all(
        self,
        base_date_text: str | None = None,
        users_json_path_text: str = "",
    ) -> DataBundle:
        if not hasattr(self.data_source, "load_dashboard_inputs"):
            raise AttributeError("data_source 에 load_dashboard_inputs() 메서드가 없습니다.")

        payload = self.data_source.load_dashboard_inputs()

        raw_df = self._require_attr(payload, "raw_df")
        partner_alias_map = self._require_attr(payload, "partner_alias_map")
        holidays = self._require_attr(payload, "holidays")
        raw_path = getattr(payload, "raw_path", "")
        partner_master_path = getattr(payload, "partner_master_path", "")
        source_name = getattr(payload, "source_name", type(self.data_source).__name__)

        if base_date_text:
            base_date = self.parse_date(base_date_text)
        else:
            base_date = datetime.today().replace(hour=0, minute=0, second=0, microsecond=0)

        if base_date is None:
            raise ValueError("기준일 형식이 올바르지 않습니다. 예: 2026-04-05")

        adjusted_base_date = self.adjust_to_next_business_day(base_date, holidays)
        df = self.transform_mps(raw_df, adjusted_base_date, holidays)

        self.bundle = DataBundle(
            partner_alias_map=partner_alias_map,
            holidays=holidays,
            df=df,
            base_date=adjusted_base_date,
            loaded_at=datetime.now(),
            raw_path=raw_path,
            partner_master_path=partner_master_path,
            users_json_path=users_json_path_text,
            source_name=source_name,
        )
        return self.bundle

    @classmethod
    def transform_mps(
        cls,
        source_df: pd.DataFrame,
        base_date: datetime,
        holidays: set[date],
    ) -> pd.DataFrame:
        df = source_df.copy()
        df.columns = [str(c).strip() for c in df.columns]

        for col in RAW_DISPLAY_HEADERS:
            if col not in df.columns:
                df[col] = ""

        df["Lot"] = df["Lot"].ffill()
        df["WO"] = df["WO"].fillna("").astype(str).str.strip()
        df = df[df["WO"] != ""].copy()

        for col in cls.DATE_COLUMNS:
            df[col] = df[col].apply(cls.parse_date)

        df["기준일"] = base_date
        df["기준일문자"] = DateHelper.format_date(base_date, DATE_FMT)
        df["상태"] = df.apply(lambda r: cls.calc_status(r, base_date), axis=1)

        df["phase_green_start"] = df["생산시작일"]
        df["phase_green_end"] = df["Tuning시작일"].apply(
            lambda x: cls.previous_business_day(x, holidays) if not DateHelper.is_empty_date(x) else None
        )
        df["phase_blue_start"] = df.apply(
            lambda r: r["Tuning시작일"] if not DateHelper.is_empty_date(r["Tuning시작일"]) else r["생산시작일"],
            axis=1,
        )
        df["phase_blue_end"] = df["생산완료일"]

        display_cols = [*RAW_DISPLAY_HEADERS, "상태", "기준일문자"]
        phase_cols = ["phase_green_start", "phase_green_end", "phase_blue_start", "phase_blue_end"]

        return df[display_cols + phase_cols].reset_index(drop=True)

    @staticmethod
    def calc_status(row: pd.Series, base_date: datetime) -> str:
        start_date = row.get("생산시작일")
        tuning_date = row.get("Tuning시작일")
        end_date = row.get("생산완료일")

        if (
            DateHelper.is_empty_date(start_date)
            or DateHelper.is_empty_date(tuning_date)
            or DateHelper.is_empty_date(end_date)
        ):
            return "미정"

        if base_date < start_date:
            return "생산예정"
        if start_date <= base_date < tuning_date:
            return "조립중"
        if tuning_date <= base_date <= end_date:
            return "Tuning중"
        if base_date >= (end_date + timedelta(days=1)):
            return "생산완료"

        return "미정"

    @staticmethod
    def parse_date(value: Any) -> datetime | None:
        return DateHelper.to_datetime(value)

    @staticmethod
    def adjust_to_next_business_day(dt: datetime, holidays: set[date]) -> datetime:
        cur = dt
        while cur.weekday() >= 5 or cur.date() in holidays:
            cur += timedelta(days=1)
        return cur

    @staticmethod
    def previous_business_day(dt: datetime | None, holidays: set[date]) -> datetime | None:
        if dt is None:
            return None

        try:
            if pd.isna(dt):
                return None
        except Exception:
            pass

        if dt is pd.NaT:
            return None

        cur = dt - timedelta(days=1)
        while cur.weekday() >= 5 or cur.date() in holidays:
            cur -= timedelta(days=1)
        return cur

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

    @staticmethod
    def safe_str(value: Any) -> str:
        return DateHelper.format_date(value, DATE_FMT)

    def get_scoped_records(self, user: dict[str, Any]) -> list[dict[str, Any]]:
        if self.bundle.df.empty:
            return []

        records: list[dict[str, Any]] = []
        for _, row in self.bundle.df.iterrows():
            rec = {"상태": self.safe_str(row["상태"])}

            for col in RAW_DISPLAY_HEADERS:
                rec[col] = self.safe_str(row[col])

            rec["기준일문자"] = self.safe_str(row["기준일문자"])
            rec["phase_green_start"] = self.safe_str(row["phase_green_start"])
            rec["phase_green_end"] = self.safe_str(row["phase_green_end"])
            rec["phase_blue_start"] = self.safe_str(row["phase_blue_start"])
            rec["phase_blue_end"] = self.safe_str(row["phase_blue_end"])
            records.append(rec)

        role = str(user.get("role", "")).lower()
        if role == "admin":
            return records

        partner = user.get("partner")
        aliases = self.get_partner_aliases(partner)

        scoped = []
        for row in records:
            combined = self.get_row_combined_partner_text(row)
            if any(alias and alias in combined for alias in aliases):
                scoped.append(row)

        return scoped

    def get_partner_aliases(self, partner_name: str | None) -> list[str]:
        if not partner_name:
            return []

        if partner_name in self.bundle.partner_alias_map:
            return self.bundle.partner_alias_map[partner_name]

        normalized_partner = self.normalize_text(partner_name)
        for key, aliases in self.bundle.partner_alias_map.items():
            all_values = [self.normalize_text(key), *[self.normalize_text(a) for a in aliases]]
            if normalized_partner in all_values:
                return aliases

        return [normalized_partner]

    def get_row_combined_partner_text(self, row: dict[str, Any]) -> str:
        fields = ["EFEM", "TM", "PM", "SU", "Harness", "Stage", "Tuning", "Remark"]
        return "".join(self.normalize_text(row.get(f, "")) for f in fields)