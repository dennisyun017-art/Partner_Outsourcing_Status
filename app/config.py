from __future__ import annotations

import os
from dotenv import load_dotenv
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent

STATIC_DIR = APP_DIR / "static"
TEMPLATES_DIR = APP_DIR / "templates"

DATA_DIR = Path(os.getenv("DATA_DIR", str(PROJECT_ROOT / "data"))).expanduser()
RAW_DIR = Path(os.getenv("RAW_DIR", str(DATA_DIR / "Raw"))).expanduser()
REFERENCE_DIR = Path(os.getenv("REFERENCE_DIR", str(DATA_DIR / "Reference"))).expanduser()
USERS_JSON_PATH = Path(os.getenv("USERS_JSON_PATH", str(DATA_DIR / "users.json"))).expanduser()
LOG_DIR = Path(os.getenv("LOG_DIR", str(PROJECT_ROOT / "logs"))).expanduser()

APP_TITLE = os.getenv("APP_TITLE", "Partner Outsourcing Status Web")
APP_VERSION = os.getenv("APP_VERSION", "v0.1.0")
APP_LAST_MODIFIED = os.getenv("APP_LAST_MODIFIED", "2026-04-05")
APP_AUTHOR = os.getenv("APP_AUTHOR", "윤상호")

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "partner_outsourcing_session")
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY", "CHANGE_THIS_SESSION_SECRET")

DATE_FMT = "%Y-%m-%d"

LATEST_RAW_FILE_REGEX = r"^Partner_Outsourcing_Status_Raw_(\d{8})_v(\d+)\.(xlsx|xlsm|xls)$"

PARTNER_MASTER_CANDIDATES = [
    "Partner_Master.xlsm",
    "Partner_Master.xlsx",
    "PARTNER_MASTER.xlsm",
    "PARTNER_MASTER.xlsx",
]

DATA_SOURCE = os.getenv("DATA_SOURCE", "excel").strip().lower()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def ensure_directories() -> None:
    for path in [DATA_DIR, RAW_DIR, REFERENCE_DIR, LOG_DIR, STATIC_DIR, TEMPLATES_DIR]:
        path.mkdir(parents=True, exist_ok=True)