@echo off
chcp 65001 >nul
:: Project Golem v9.0 - 一鍵啟動 (Windows Bridge)
:: 此腳本統一由 setup.bat 處理啟動邏輯，確保穩定性

cd /d "%~dp0"

:: 檢查是否為初次執行 (.env 或 node_modules 不存在)
if not exist ".env" (
    echo [INFO] 正在進入自動安裝流程...
    call setup.bat --install
) else if not exist "node_modules" (
    echo [INFO] 正在安裝依賴...
    call setup.bat --install
) else (
    :: 已經安裝過，直接啟動系統
    call setup.bat --start
)
