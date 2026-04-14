@echo off
title Partner Status - 8001

cd /d %~dp0

echo ========================================
echo   Partner Outsourcing Status (8001)
echo ========================================

IF EXIST app\main.py (
    echo [INFO] app.main detected
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8001
) ELSE IF EXIST main.py (
    echo [INFO] main detected
    python -m uvicorn main:app --host 0.0.0.0 --port 8001
) ELSE (
    echo [ERROR] main.py not found!
)

pause