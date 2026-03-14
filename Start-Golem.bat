@echo off
chcp 65001 >nul
:: Project Golem v9.0 - 一鍵啟動 (Windows Bridge)
:: 此腳本統一由 setup.bat 處理啟動邏輯，確保穩定性

cd /d "%~dp0"

:: 統一呼叫 setup.bat 處理所有邏輯，對齊跨平台體驗
call setup.bat --start

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 啟動失敗！
    pause
)
