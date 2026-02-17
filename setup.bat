@echo off
setlocal EnableDelayedExpansion
:: 設定編碼為 UTF-8 以支援繁體中文
chcp 65001 >nul
:: 鎖定工作目錄為腳本所在位置
cd /d "%~dp0"
title Project Golem v9.0 Setup (Titan Chronos)

:: =======================================================
:: Project Golem v9.0 (Titan Chronos) - 自動化安裝精靈
:: =======================================================

:MainMenu
cls
echo.
echo =======================================================
echo  Project Golem v9.0 主控制台
echo =======================================================
echo.
echo  請選擇操作模式：
echo.
echo  [0] 啟動系統 (TUI 終端機 + Web 儀表板)
echo  -------------------------------------------------------
echo  [1] 完整安裝與部署 (安裝依賴 + 配置 + 編譯)
echo  [2] 僅更新配置 (重新設定 .env)
echo  [3] 僅修復依賴 (重新安裝 npm 套件)
echo  [Q] 離開
echo.
set /p "CHOICE=請輸入選項 (0/1/2/3/Q): "

if /i "%CHOICE%"=="0" goto :LaunchSystem
if /i "%CHOICE%"=="1" goto :StepCheckFiles
if /i "%CHOICE%"=="2" goto :ConfigWizard
if /i "%CHOICE%"=="3" goto :StepInstallCore
if /i "%CHOICE%"=="Q" exit /b 0
goto :MainMenu

:: =======================================================
:: 1. 核心檔案檢查
:: =======================================================
:StepCheckFiles
cls
echo.
echo [1/6] 正在檢查核心檔案完整性...
set "MISSING_FILES="

if not exist index.js set "MISSING_FILES=!MISSING_FILES! index.js"
if not exist skills.js set "MISSING_FILES=!MISSING_FILES! skills.js"
if not exist package.json set "MISSING_FILES=!MISSING_FILES! package.json"
if not exist dashboard.js set "MISSING_FILES=!MISSING_FILES! dashboard.js"

if defined MISSING_FILES (
    echo.
    echo [ERROR] 嚴重錯誤：核心檔案遺失！
    echo 缺失檔案: "!MISSING_FILES!"
    echo 請確保您已完整解壓縮 V9.0 檔案包。
    pause
    goto :MainMenu
)
echo    [OK] 核心檔案檢查通過。

:: =======================================================
:: 2. Node.js 環境檢查與自動安裝
:: =======================================================
:StepCheckNode
echo.
echo [2/6] 正在檢查 Node.js 環境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo    [WARN] 未檢測到 Node.js。
    echo    [*] 正在嘗試使用 Winget 自動安裝 LTS 版本...
    echo    請在彈出的視窗中接受協議...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if !errorlevel! neq 0 (
        echo    [ERROR] 自動安裝失敗。請手動下載安裝 Node.js。
        pause
        exit /b
    )
    echo    [OK] Node.js 安裝成功！請重新啟動此腳本。
    pause
    exit
)
echo    [OK] Node.js 環境已就緒。

:: =======================================================
:: 3. 環境變數配置 (.env)
:: =======================================================
:StepCheckEnv
echo.
echo [3/6] 正在檢查環境設定檔...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo    [OK] 已從範本建立 .env 檔案。
    ) else (
        echo    [ERROR] 找不到 .env.example，跳過配置步驟。
        goto :StepInstallCore
    )
)

:ConfigWizard
cls
echo.
echo =======================================================
echo  環境變數配置精靈 (.env)
echo =======================================================

:: --- Gemini ---
echo.
echo [1/2] Google Gemini API Keys (必填)
echo -------------------------------------------------------
:AskGemini
set "INPUT_GEMINI="
set /p "INPUT_GEMINI=請輸入 Keys (多組請用逗號分隔): "
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
set /p "INPUT_TG=請輸入 Bot Token: "
if "!INPUT_TG!"=="" (
    echo    [ERROR] 此欄位為必填！
    goto :AskTGToken
)
call :UpdateEnv "TELEGRAM_TOKEN" "!INPUT_TG!"

:AskTGUser
set "INPUT_TG_ID="
set /p "INPUT_TG_ID=請輸入管理員 User ID: "
if "!INPUT_TG_ID!"=="" (
    echo    [ERROR] 此欄位為必填！
    goto :AskTGUser
)
call :UpdateEnv "ADMIN_ID" "!INPUT_TG_ID!"

echo.
echo    [OK] 配置已儲存。
if "%CHOICE%"=="2" goto :MainMenu

:: =======================================================
:: 4. 核心依賴安裝
:: =======================================================
:StepInstallCore
echo.
echo [4/6] 正在安裝後端核心依賴...
call npm install
if %ERRORLEVEL% neq 0 (
    echo    [ERROR] npm install 失敗，請檢查網路連線。
    pause
    goto :MainMenu
)

echo.
echo    [*] 正在驗證 Dashboard TUI 套件...
if not exist "node_modules\blessed" call npm install blessed blessed-contrib
echo    [OK] 核心依賴準備就緒。

:: =======================================================
:: 5. Web Dashboard 建置 (關鍵修復步驟)
:: =======================================================
:StepInstallWeb
echo.
echo [5/6] 正在設定 Web Dashboard...
if exist "web-dashboard" (
    echo    [*] 偵測到 web-dashboard 目錄。
    echo    [*] 正在安裝前端依賴 (這可能需要幾分鐘)...
    cd web-dashboard
    call npm install
    if !errorlevel! neq 0 (
        echo    [WARN] 前端依賴安裝失敗，Web 介面可能無法使用。
    ) else (
        echo    [*] 正在編譯 Next.js 應用程式...
        call npm run build
        if !errorlevel! neq 0 (
            echo    [WARN] 編譯失敗。Web 介面可能無法存取。
        ) else (
            echo    [OK] Web Dashboard 編譯成功。
        )
    )
    cd ..
) else (
    echo    [WARN] 找不到 web-dashboard 目錄，跳過編譯步驟。
)

:: =======================================================
:: 6. 完成
:: =======================================================
:StepFinal
cls
echo.
echo =======================================================
echo  部署成功！ (Project Golem v9.0 Titan)
echo =======================================================
echo.
echo  系統已準備就緒。
echo.
echo  [Y] 立即啟動系統
echo  [N] 返回主選單
echo.

choice /C YN /N /T 10 /D Y /M "系統將在 10 秒後自動啟動 (Y/N)? "
if errorlevel 2 goto :MainMenu
if errorlevel 1 goto :LaunchSystem

:: =======================================================
:: 啟動邏輯
:: =======================================================
:LaunchSystem
cls
echo.
echo =======================================================
echo  正在啟動 Golem v9.0...
echo =======================================================
echo.
echo  [INFO] 正在載入神經記憶體與儀表板...
echo  [INFO] Web 介面網址: http://localhost:3000
echo  [TIPS] 若要離開，請按 'q' 或 Ctrl+C。
echo.

npm run dashboard

echo.
echo  [INFO] 系統已停止。
pause
goto :MainMenu

:: =======================================================
:: 輔助函數區
:: =======================================================
:UpdateEnv
set "KEY_NAME=%~1"
set "NEW_VALUE=%~2"
powershell -Command "(Get-Content .env) -replace '^%KEY_NAME%=.*', '%KEY_NAME%=%NEW_VALUE%' | Set-Content .env -Encoding UTF8"
exit /b
