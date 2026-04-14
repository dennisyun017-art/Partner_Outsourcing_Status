from .excel_source import (
    DashboardInputPayload,
    ExcelDashboardInput,
    ExcelDataSource,
)
from .supabase_source import SupabaseDataSource

# 예전 이름과의 호환용 별칭
ExcelSource = ExcelDataSource
SupabaseSource = SupabaseDataSource

__all__ = [
    "DashboardInputPayload",
    "ExcelDashboardInput",
    "ExcelDataSource",
    "SupabaseDataSource",
    "ExcelSource",
    "SupabaseSource",
]