from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

import pandas as pd
from supabase import create_client, Client

from app.auth_service import AuthService
from app.config import REFERENCE_DIR, USERS_JSON_PATH
from app.data_service import RAW_DISPLAY_HEADERS
from app.data_sources import ExcelDataSource

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

CHUNK_SIZE = 500
RESET_TABLES_FIRST = True


def require_env(name: str, value: str) -> str:
    if not value or not str(value).strip():
        raise ValueError(f"환경변수 {name} 값이 비어 있습니다.")
    return value.strip()


def get_supabase_client() -> Client:
    url = require_env("SUPABASE_URL", SUPABASE_URL)
    key = require_env("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY)
    return create_client(url, key)


def chunked(rows: list[dict], size: int):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def clean_text(value):
    if value is None:
        return None
    text = str(value).strip()
    if text == "" or text.lower() in {"nan", "none", "nat"}:
        return None
    return text


def to_iso_date(value):
    dt = ExcelDataSource.parse_date(value)
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d")


def delete_all_rows(client: Client):
    print("[INFO] 기존 데이터 삭제 시작")

    client.table("mps_records").delete().gt("id", 0).execute()
    client.table("partner_master").delete().gt("id", 0).execute()
    client.table("users").delete().gt("id", 0).execute()
    client.table("holidays").delete().gte("holiday_date", "1900-01-01").execute()

    print("[INFO] 기존 데이터 삭제 완료")


def load_partner_master_dataframe(path: Path) -> pd.DataFrame:
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
    return df


def build_users_rows() -> list[dict]:
    users = AuthService.load_users(USERS_JSON_PATH)
    rows: list[dict] = []

    for user_id, info in users.items():
        rows.append({
            "user_id": user_id,
            "password": clean_text(info.get("password")),
            "role": clean_text(info.get("role")) or "partner",
            "partner": clean_text(info.get("partner")),
            "name": clean_text(info.get("name")) or user_id,
            "is_active": True,
        })

    return rows


def build_partner_master_rows(source: ExcelDataSource) -> list[dict]:
    partner_master_path = source.find_partner_master_file(REFERENCE_DIR)
    if partner_master_path is None:
        raise FileNotFoundError(f"Partner Master 파일이 없습니다: {REFERENCE_DIR}")

    df = load_partner_master_dataframe(partner_master_path)

    required_cols = ["partner_id", "partner_name_ko", "partner_name_en", "alias", "use_yn"]
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"Partner Master 필수 컬럼 누락: {col}")

    rows: list[dict] = []
    for _, row in df.iterrows():
        partner_name_ko = clean_text(row.get("partner_name_ko"))
        if not partner_name_ko:
            continue

        rows.append({
            "partner_id": clean_text(row.get("partner_id")),
            "partner_name_ko": partner_name_ko,
            "partner_name_en": clean_text(row.get("partner_name_en")),
            "alias": clean_text(row.get("alias")),
            "use_yn": clean_text(row.get("use_yn")) or "Y",
        })

    return rows


def build_holiday_rows(source: ExcelDataSource) -> list[dict]:
    payload = source.load_dashboard_inputs()
    rows: list[dict] = []

    for holiday_date in sorted(payload.holidays):
        rows.append({
            "holiday_date": holiday_date.strftime("%Y-%m-%d"),
            "holiday_name": None,
        })

    return rows


def build_mps_rows(source: ExcelDataSource) -> list[dict]:
    payload = source.load_dashboard_inputs()
    df = payload.raw_df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    for col in RAW_DISPLAY_HEADERS:
        if col not in df.columns:
            df[col] = ""

    df = df.reset_index().rename(columns={"index": "_source_index"})
    df["Lot"] = df["Lot"].ffill()
    df["WO"] = df["WO"].fillna("").astype(str).str.strip()
    df = df[df["WO"] != ""].copy()

    rows: list[dict] = []
    source_file_name = Path(payload.raw_path).name

    for _, row in df.iterrows():
        rows.append({
            "lot": clean_text(row.get("Lot")),
            "code": clean_text(row.get("CODE")),
            "wo": clean_text(row.get("WO")),
            "serial_no": clean_text(row.get("S/N")),
            "customer": clean_text(row.get("Customer")),
            "line": clean_text(row.get("Line")),
            "model": clean_text(row.get("Model")),
            "fsc": clean_text(row.get("FSC")),
            "efem": clean_text(row.get("EFEM")),
            "tm": clean_text(row.get("TM")),
            "pm": clean_text(row.get("PM")),
            "su": clean_text(row.get("SU")),
            "harness": clean_text(row.get("Harness")),
            "stage": clean_text(row.get("Stage")),
            "tuning": clean_text(row.get("Tuning")),
            "production_start_date": to_iso_date(row.get("생산시작일")),
            "tuning_start_date": to_iso_date(row.get("Tuning시작일")),
            "production_end_date": to_iso_date(row.get("생산완료일")),
            "remark": clean_text(row.get("Remark")),
            "source_file_name": source_file_name,
            "row_no": int(row["_source_index"]) + 2,
            "is_active": True,
        })

    return rows


def insert_rows(client: Client, table_name: str, rows: list[dict]):
    if not rows:
        print(f"[INFO] {table_name}: 삽입할 데이터 없음")
        return

    print(f"[INFO] {table_name}: {len(rows)}건 삽입 시작")
    inserted = 0

    for batch in chunked(rows, CHUNK_SIZE):
        client.table(table_name).insert(batch).execute()
        inserted += len(batch)
        print(f"[INFO] {table_name}: {inserted}/{len(rows)}")

    print(f"[INFO] {table_name}: 삽입 완료")


def main():
    print("[INFO] Supabase 이관 시작")

    client = get_supabase_client()
    source = ExcelDataSource()

    if RESET_TABLES_FIRST:
        delete_all_rows(client)

    users_rows = build_users_rows()
    partner_rows = build_partner_master_rows(source)
    holiday_rows = build_holiday_rows(source)
    mps_rows = build_mps_rows(source)

    insert_rows(client, "users", users_rows)
    insert_rows(client, "partner_master", partner_rows)
    insert_rows(client, "holidays", holiday_rows)
    insert_rows(client, "mps_records", mps_rows)

    print("[INFO] Supabase 이관 완료")
    print(f"[INFO] users={len(users_rows)}")
    print(f"[INFO] partner_master={len(partner_rows)}")
    print(f"[INFO] holidays={len(holiday_rows)}")
    print(f"[INFO] mps_records={len(mps_rows)}")


if __name__ == "__main__":
    main()