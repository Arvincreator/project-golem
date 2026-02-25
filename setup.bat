@echo off
:: Project Golem v9.0 - Launcher
:: 將所有邏輯交給 PowerShell 處理，以完整支援繁體中文
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
