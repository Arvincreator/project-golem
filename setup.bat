@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: Project Golem v9.0 - Windows Launcher
:: 此腳本會呼叫 PowerShell 版本以獲得最佳的 Windows 相容性

set "SCRIPT_DIR=%~dp0"
cd /d "!SCRIPT_DIR!"

:: 檢查 PowerShell 是否可用
where powershell >nul 2>&1
if !errorlevel! equ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup.ps1" %*
) else (
    echo [ERROR] 找不到 PowerShell！
    echo 請確保您的系統已安裝 PowerShell。
    echo 您也可以嘗試使用 Git Bash 執行 ./setup.sh --install
    pause
    exit /b 1
)

exit /b %errorlevel%
