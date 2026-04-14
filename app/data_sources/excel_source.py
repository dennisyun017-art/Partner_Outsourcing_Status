from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from ..config import (
    LATEST_RAW_FILE_REGEX,
    PARTNER_MASTER_CANDIDATES,
    RAW_DIR,
    REFERENCE_DIR,
)


@dataclass
class DashboardInputPayload:
    raw_df: pd.DataFrame
    partner_alias_map: dict[str, list[str]]
    holidays: set[date]
    raw_path: str
    partner_master_path: str
    source_name: str = "excel"


ExcelDashboardInput = DashboardInputPayload


class ExcelDataSource:
    def load_dashboard_inputs(self) -> DashboardInputPayload:
        raw_path = self.find_latest_raw_file(RAW_DIR)
        partner_master_path = self.find_partner_master_file(REFERENCE_DIR)

        if raw_path is None:
            raise FileNotFoundError(f"Raw 파일이 없습니다: {RAW_DIR}")
        if partner_master_path is None:
            raise FileNotFoundError(f"Partner Master 파일이 없습니다: {REFERENCE_DIR}")

        raw_df = self.load_mps_dataframe(raw_path)
        partner_alias_map = self.load_partner_master(partner_master_path)
        holidays = self.load_holidays(raw_path)

        return DashboardInputPayload(
            raw_df=raw_df,
            partner_alias_map=partner_alias_map,
            holidays=holidays,
            raw_path=str(raw_path),
            partner_master_path=str(partner_master_path),
            source_name="excel",
        )

    @staticmethod
    def find_latest_raw_file(folder: Path) -> Path | None:
        if not folder.exists():
            return None

        candidates: list[tuple[str, int, float, Path]] = []
        pattern = re.compile(LATEST_RAW_FILE_REGEX, re.IGNORECASE)

        for file in folder.iterdir():
            if not file.is_file():
                continue

            match = pattern.match(file.name)
            if match:
                ymd = match.group(1)
                ver = int(match.group(2))
                candidates.append((ymd, ver, file.stat().st_mtime, file))

        if candidates:
            candidates.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
            return candidates[0][3]

        fallback = [
            f for f in folder.iterdir()
            if f.is_file() and f.suffix.lower() in [".xlsx", ".xls", ".xlsm"]
        ]
        if fallback:
            fallback.sort(key=lambda x: x.stat().st_mtime, reverse=True)
            return fallback[0]

        return None

    @staticmethod
    def find_partner_master_file(folder: Path) -> Path | None:
        if not folder.exists():
            return None

        for name in PARTNER_MASTER_CANDIDATES:
            candidate = folder / name
            if candidate.exists():
                return candidate

        fallback = [
            f for f in folder.iterdir()
            if f.is_file()
            and f.suffix.lower() in [".xlsx", ".xlsm"]
            and "partner_master" in f.name.lower()
        ]
        if fallback:
            fallback.sort(key=lambda x: x.stat().st_mtime, reverse=True)
            return fallback[0]

        return None

    @staticmethod
    def load_mps_dataframe(raw_path: Path) -> pd.DataFrame:
        df = pd.read_excel(raw_path, sheet_name="MPS", dtype=str)
        df.columns = [str(c).strip() for c in df.columns]
        return df

    @classmethod
    def load_partner_master(cls, path: Path) -> dict[str, list[str]]:
        excel = pd.ExcelFile(path)
        preferred_names = [
            "PARTNER_MASTER",
            "Partner_Master",
            "partner_master",
            "PARTNER MASTER",
            "Partner Master",
        ]

        selected_sheet = next(
            (name for name in preferred_names if name in excel.sheet_names),
            excel.sheet_names[0]
        )

        df = pd.read_excel(path, sheet_name=selected_sheet, dtype=str)
        df.columns = [str(c).strip() for c in df.columns]

        required_cols = ["partner_id", "partner_name_ko", "partner_name_en", "alias", "use_yn"]
        missing = [c for c in required_cols if c not in df.columns]
        if missing:
            raise ValueError(
                "Partner Master 필수 컬럼 누락: "
                + ", ".join(missing)
                + f" / 현재 시트: {selected_sheet} / 현재 컬럼: {', '.join(df.columns)}"
            )

        partner_alias_map: dict[str, list[str]] = {}
        for _, row in df.iterrows():
            use_yn = str(row.get("use_yn", "")).strip().upper()
            if use_yn != "Y":
                continue

            partner_name_ko = str(row.get("partner_name_ko", "")).strip()
            partner_name_en = str(row.get("partner_name_en", "")).strip()
            alias_text = str(row.get("alias", "")).strip()

            aliases = set(cls.split_aliases(alias_text))
            if partner_name_ko:
                aliases.add(cls.normalize_text(partner_name_ko))
            if partner_name_en:
                aliases.add(cls.normalize_text(partner_name_en))

            if partner_name_ko:
                partner_alias_map[partner_name_ko] = sorted(a for a in aliases if a)

        if "금송" not in partner_alias_map:
            partner_alias_map["금송"] = sorted({
                cls.normalize_text("금송"),
                cls.normalize_text("Geumsong"),
            })

        return partner_alias_map

    @classmethod
    def load_holidays(cls, raw_path: Path) -> set[date]:
        try:
            raw = pd.read_excel(raw_path, sheet_name="HOLIDAY", header=None)
        except Exception:
            return set()

        holidays: set[date] = set()
        best_col = None
        best_count = -1

        for col in raw.columns:
            parsed = 0
            for value in raw[col].tolist():
                if cls.parse_date(value):
                    parsed += 1
            if parsed > best_count:
                best_count = parsed
                best_col = col

        if best_col is None or best_count <= 0:
            return holidays

        for value in raw[best_col].tolist():
            parsed = cls.parse_date(value)
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