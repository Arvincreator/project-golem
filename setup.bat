@echo off
setlocal EnableDelayedExpansion
:: 設定編碼為 UTF-8 以支援中文顯示
chcp 65001 >nul
cd /d "%~dp0"
title Project Golem Manager

:: ==========================================
:: Project Golem 整合管理系統 (All-in-One)
:: ==========================================

:MainMenu
cls
echo.
echo =======================================================
echo  Project Golem Master Controller
echo =======================================================
echo.
echo  請選擇操作模式：
echo.
echo  [0] 直接啟動系統 (Start System)
echo  -------------------------------------------------------
echo  [1] 完整安裝與部署 (Full Setup)
echo  [2] 僅更新配置 (.env Wizard)
echo  [3] 僅安裝依賴 (Install Dependencies)
echo  [Q] 退出
echo.
set /p "CHOICE=請輸入選項 (0/1/2/3/Q): "

if /i "%CHOICE%"=="0" goto :LaunchSystem
if /i "%CHOICE%"=="1" goto :StepCheckEnv
if /i "%CHOICE%"=="2" goto :ConfigWizard
if /i "%CHOICE%"=="3" goto :StepInstallCore
if /i "%CHOICE%"=="Q" exit /b 0
goto :MainMenu

:: ==========================================
:: 1. 環境檔案準備
:: ==========================================
:StepCheckEnv
echo.
echo [1/4] 檢查環境設定檔...
if not exist ".env" (
    echo    [WARN] 未檢測到 .env，正在從範本建立...
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo    [OK] 已建立 .env 檔案。
    ) else (
        echo    [ERROR] 找不到 .env.example，無法建立配置！
        goto :Error
    )
) else (
    echo    [OK] .env 檔案已存在。
)

:: ==========================================
:: 2. 配置精靈 (Configuration Wizard)
:: ==========================================
:ConfigWizard
cls
echo.
echo =======================================================
echo  環境變數配置精靈 (.env)
echo =======================================================

:: --- 設定 Gemini keys ---
echo.
echo [1/2] Google Gemini API Keys (必填)
echo -------------------------------------------------------
echo  格式：Key1,Key2 (逗號分隔)
:AskGemini
set "INPUT_GEMINI="
set /p "INPUT_GEMINI=Gemini Keys: "
if "!INPUT_GEMINI!"=="" (
    echo    [ERROR] 此欄位為必填！
    goto :AskGemini
)
call :UpdateEnv "GEMINI_API_KEY" "!INPUT_GEMINI!"

:: --- 設定 Telegram ---
echo.
echo [2/2] Telegram Bot 設定 (必填)
echo -------------------------------------------------------
:AskTGToken
set "INPUT_TG="
set /p "INPUT_TG=Telegram Bot Token: "
if "!INPUT_TG!"=="" (
    echo    [ERROR] 此欄位為必填！
    goto :AskTGToken
)
call :UpdateEnv "TELEGRAM_BOT_TOKEN" "!INPUT_TG!"

:AskTGUser
set "INPUT_TG_ID="
set /p "INPUT_TG_ID=Admin User ID: "
if "!INPUT_TG_ID!"=="" (
    echo    [ERROR] 此欄位為必填！
    goto :AskTGUser
)
call :UpdateEnv "TELEGRAM_USER_ID" "!INPUT_TG_ID!"

:: --- 設定 Discord (選填) ---
echo.
echo [Optional] Discord Bot 設定
set "INPUT_DC="
set /p "INPUT_DC=Discord Token (按Enter跳過): "
if not "!INPUT_DC!"=="" call :UpdateEnv "DISCORD_TOKEN" "!INPUT_DC!"

echo.
echo  [OK] 配置完成！
if "%CHOICE%"=="2" goto :MainMenu

:: ==========================================
:: 3. 依賴安裝
:: ==========================================
:StepInstallCore
echo.
echo [3/4] 安裝核心依賴...
call npm install
if %ERRORLEVEL% neq 0 goto :Error

echo.
echo [4/4] 安裝儀表板...
if exist "web-dashboard" (
    cd web-dashboard
    call npm install
    cd ..
) else (
    echo    [WARN] 無 Dashboard 資料夾，跳過。
)

:: ==========================================
:: 4. 安裝完成與倒數啟動
:: ==========================================
:StepFinal
cls
echo.
echo =======================================================
echo  部署成功！所有系統已就緒。
echo =======================================================
echo.
echo  系統將在 10 秒後自動啟動...
echo     [Y] 立即啟動
echo     [N] 返回主選單
echo.

choice /C YN /N /T 10 /D Y /M "是否啟動系統 (Y/N)? "
if errorlevel 2 goto :MainMenu
if errorlevel 1 goto :LaunchSystem

:: ==========================================
:: 啟動系統核心邏輯
:: ==========================================
:LaunchSystem
cls
echo.
echo =======================================================
echo  正在啟動 Golem System...
echo =======================================================
echo.

:: 1. 啟動核心
echo [1/2] 啟動 AI Core...
start "Golem Core" cmd /k "node index.js"

:: 2. 啟動儀表板
if exist "web-dashboard\node_modules" (
    echo [2/2] 啟動 Dashboard...
    cd web-dashboard
    start "Golem Dashboard" cmd /k "npm run dev"
    cd ..
    echo.
    echo  Dashboard 網址: http://localhost:3000
) else (
    echo [SKIP] 未檢測到 Dashboard 安裝，僅啟動核心。
)

echo.
echo [OK] 啟動指令已發送，視窗將自動彈出。
echo (此視窗將在 5 秒後自動關閉)
timeout /t 5 >nul
exit

:: ==========================================
:: 錯誤處理與輔助函數
:: ==========================================
:Error
echo.
echo [ERROR] 發生錯誤，程序終止。
pause
exit /b 1

:UpdateEnv
set "KEY_NAME=%~1"
set "NEW_VALUE=%~2"
powershell -Command "(Get-Content .env) -replace '^%KEY_NAME%=.*', '%KEY_NAME%=%NEW_VALUE%' | Set-Content .env -Encoding UTF8"
echo    -> 已更新 %KEY_NAME%
exit /b
