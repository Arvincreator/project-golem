@echo off
setlocal EnableDelayedExpansion
:: 強制 UTF-8，確保中文顯示正常
chcp 65001 >nul
cd /d "%~dp0"
title Golem v9.0 Setup (Titan Chronos)

:: ==========================================
:: Project Golem v9.0 (Titan Chronos) - 整合部署系統
:: ==========================================

:MainMenu
cls
echo.
echo =======================================================
echo  🤖 Project Golem v9.0 (Titan Chronos) Master Control
echo =======================================================
echo.
echo  請選擇操作模式：
echo.
echo  [0] ⚡ 啟動系統 (Start System)
echo      (包含 Dashboard 戰術控制台)
echo  -------------------------------------------------------
echo  [1] 🚀 完整安裝與部署 (Full Setup)
echo  [2] ⚙️ 僅更新配置 (.env Wizard)
echo  [3] 📦 僅安裝/修復依賴 (Fix Dependencies)
echo  [Q] 🚪 退出
echo.
set /p "CHOICE=請輸入選項 (0/1/2/3/Q): "

if /i "%CHOICE%"=="0" goto :LaunchSystem
if /i "%CHOICE%"=="1" goto :StepCheckFiles
if /i "%CHOICE%"=="2" goto :ConfigWizard
if /i "%CHOICE%"=="3" goto :StepInstallCore
if /i "%CHOICE%"=="Q" exit /b 0
goto :MainMenu

:: ==========================================
:: 1. 檔案完整性檢查 (保留您 V9.0 的嚴謹檢查)
:: ==========================================
:StepCheckFiles
cls
echo.
echo [1/5] 🔍 正在檢查核心檔案完整性...
set "MISSING_FILES="

if not exist index.js set "MISSING_FILES=!MISSING_FILES! index.js"
if not exist skills.js set "MISSING_FILES=!MISSING_FILES! skills.js"
if not exist package.json set "MISSING_FILES=!MISSING_FILES! package.json"
if not exist dashboard.js set "MISSING_FILES=!MISSING_FILES! dashboard.js"
if not exist memory.html set "MISSING_FILES=!MISSING_FILES! memory.html"

if defined MISSING_FILES (
    echo.
    echo [ERROR] 嚴重錯誤：核心檔案遺失！
    echo 缺失檔案: "!MISSING_FILES!"
    echo 請確保您已下載完整 V9.0 檔案包。
    pause
    goto :MainMenu
)
echo    [OK] 核心檔案檢查通過。

:: ==========================================
:: 2. 環境檢查 (Node.js) - 您的 Winget 邏輯
:: ==========================================
:StepCheckNode
echo.
echo [2/5] 🔍 正在檢查 Node.js 環境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo    [WARN] 未檢測到 Node.js！
    echo    [*] 正在嘗試使用 Winget 自動安裝 LTS 版本...
    echo    請在彈出的視窗中點選「是」...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if !errorlevel! neq 0 (
        echo    [ERROR] 自動安裝失敗。請手動安裝 Node.js。
        pause
        exit /b
    )
    echo    [OK] Node.js 安裝成功！請重新啟動此腳本。
    pause
    exit
)
echo    [OK] Node.js 已就緒。

:: ==========================================
:: 3. 配置精靈 (.env)
:: ==========================================
:StepCheckEnv
echo.
echo [3/5] 📄 檢查環境設定檔...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo    [OK] 已從範本建立 .env 檔案。
    ) else (
        echo    [ERROR] 找不到 .env.example，跳過。
        goto :StepInstallCore
    )
)

:ConfigWizard
cls
echo.
echo =======================================================
echo  🧙 環境變數配置精靈 (Titan Config)
echo =======================================================

:: --- Gemini ---
echo.
echo [1/2] Google Gemini API Keys (必填)
echo -------------------------------------------------------
:AskGemini
set "INPUT_GEMINI="
set /p "INPUT_GEMINI=Gemini Keys (逗號分隔): "
if "!INPUT_GEMINI!"=="" (
    echo    [ERROR] 此欄位為必填！
    goto :AskGemini
)
call :UpdateEnv "GEMINI_API_KEYS" "!INPUT_GEMINI!"

:: --- Telegram ---
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
call :UpdateEnv "TELEGRAM_TOKEN" "!INPUT_TG!"

:AskTGUser
set "INPUT_TG_ID="
set /p "INPUT_TG_ID=Admin User ID: "
if "!INPUT_TG_ID!"=="" (
    echo    [ERROR] 此欄位為必填！
    goto :AskTGUser
)
call :UpdateEnv "ADMIN_ID" "!INPUT_TG_ID!"

echo.
echo  [OK] 配置完成！
if "%CHOICE%"=="2" goto :MainMenu

:: ==========================================
:: 4. 依賴安裝
:: ==========================================
:StepInstallCore
echo.
echo [4/5] 📦 安裝核心與 Dashboard 依賴...
call npm install
if %ERRORLEVEL% neq 0 (
    echo    [ERROR] NPM 安裝失敗，請檢查網路。
    pause
    goto :MainMenu
)

echo.
echo [5/5] 🖥️ 確認 Dashboard UI 套件...
:: 確保 blessed 存在
if not exist "node_modules\blessed" call npm install blessed blessed-contrib
echo    [OK] Dashboard 套件就緒。

:: ==========================================
:: 5. 安裝完成與啟動
:: ==========================================
:StepFinal
cls
echo.
echo =======================================================
echo  🎉 部署成功！Golem v9.0 (Titan) 已就緒。
echo =======================================================
echo.
echo  ⏳ 系統將在 5 秒後自動啟動...
echo     [Y] 立即啟動
echo     [N] 返回主選單
echo.

choice /C YN /N /T 5 /D Y /M "👉 是否啟動系統 (Y/N)? "
if errorlevel 2 goto :MainMenu
if errorlevel 1 goto :LaunchSystem

:: ==========================================
:: 🚀 啟動邏輯 (V9.0 Dashboard 模式)
:: ==========================================
:LaunchSystem
cls
echo.
echo =======================================================
echo  🚀 正在啟動 Golem v9.0...
echo =======================================================
echo.
echo  [INFO] 正在載入 Neural Memory 與 Dashboard...
echo  [INFO] 若要離開 Dashboard，請按 Ctrl+C 或 Q
echo.

:: 根據 package.json，啟動 dashboard 是 "node index.js dashboard"
npm run dashboard

echo.
echo  [INFO] 系統已關閉。
pause
goto :MainMenu

:: ==========================================
:: 輔助函數
:: ==========================================
:UpdateEnv
set "KEY_NAME=%~1"
set "NEW_VALUE=%~2"
powershell -Command "(Get-Content .env) -replace '^%KEY_NAME%=.*', '%KEY_NAME%=%NEW_VALUE%' | Set-Content .env -Encoding UTF8"
exit /b
