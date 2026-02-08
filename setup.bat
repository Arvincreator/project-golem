@echo off
setlocal EnableDelayedExpansion
:: 切換編碼為 UTF-8 以支援中文顯示
chcp 65001 >nul

title Golem v8.5 全自動安裝精靈
echo ==========================================================
echo  Project Golem v8.5 (Neuro-Link) - 全自動安裝精靈
echo ==========================================================
echo.

:: ------------------------------------------------------------
:: 0. 檔案完整性檢查
:: ------------------------------------------------------------
echo [1/6] 正在檢查核心檔案完整性...
set "MISSING_FILES="
if not exist index.js set "MISSING_FILES=!MISSING_FILES! index.js"
if not exist skills.js set "MISSING_FILES=!MISSING_FILES! skills.js"
if not exist package.json set "MISSING_FILES=!MISSING_FILES! package.json"
if not exist memory.html set "MISSING_FILES=!MISSING_FILES! memory.html"

if defined MISSING_FILES (
    echo.
    echo [ERROR] 錯誤：核心檔案遺失！(!MISSING_FILES!)
    pause
    exit /b
)
echo [OK] 核心檔案檢查通過。
echo.

:: ------------------------------------------------------------
:: 1. 檢查並自動安裝 Node.js
:: ------------------------------------------------------------
echo [2/6] 正在檢查 Node.js 環境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] 偵測到未安裝 Node.js！
    echo [*] 正在嘗試使用 Windows Winget 自動下載並安裝 (LTS 版本)...
    echo [-] 這可能需要幾分鐘，且可能會跳出「允許變更」視窗，請點選 [是]...
    echo.
    
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] 自動安裝失敗 (可能是您的 Windows 版本太舊不支援 Winget)。
        echo [>] 請手動前往官網下載安裝：https://nodejs.org/
        pause
        exit /b
    ) else (
        echo.
        echo [OK] Node.js 安裝成功！
        echo [!] 重要：由於 Windows 環境變數限制，您必須 **關閉此視窗** 並 **重新執行 setup.bat** 才能生效。
        echo.
        pause
        exit
    )
)
echo [OK] Node.js 已安裝。
echo.

:: ------------------------------------------------------------
:: 2. 設定環境變數 (.env)
:: ------------------------------------------------------------
echo [3/6] 正在設定環境變數 (.env)...
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo [OK] 已從範本建立 .env 檔案。
    ) else (
        echo [!] 找不到 .env.example，跳過。
    )
) else (
    echo [OK] .env 已存在。
)
echo.

:: ------------------------------------------------------------
:: 3. 安裝 NPM 依賴 (含 Dashboard)
:: ------------------------------------------------------------
echo [4/6] 正在安裝核心依賴...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] NPM 安裝失敗。請檢查網路連線。
    pause
    exit /b
)

echo [+] 正在加裝 Dashboard (戰術控制台) 擴充套件...
call npm install blessed blessed-contrib
if %errorlevel% neq 0 (
    echo [!] Dashboard 套件安裝失敗 (非致命錯誤)，您可能無法使用圖形介面。
) else (
    echo [OK] Dashboard 套件安裝完成。
)
echo.

:: ------------------------------------------------------------
:: 4. 設定記憶引擎 (Windows 僅支援瀏覽器模式)
:: ------------------------------------------------------------
echo [5/6] 正在設定 Golem 記憶引擎...
echo [*] 配置為：瀏覽器模式 (原生推薦)...
powershell -Command "(Get-Content .env) -replace 'GOLEM_MEMORY_MODE=.*', 'GOLEM_MEMORY_MODE=browser' | Set-Content .env"
echo.

:: ------------------------------------------------------------
:: 5. 自動修補檢測 (Auto-Patch)
:: ------------------------------------------------------------
echo [6/6] 正在檢查自動修補腳本 (patch.js)...
if exist patch.js (
    echo [*] 偵測到 patch.js，正在執行修補程序...
    echo ----------------------------------------------------------
    call node patch.js
    echo ----------------------------------------------------------
    if !errorlevel! equ 0 (
        echo [OK] 自動修補執行完畢！
        echo [-] (若需保留補丁紀錄，patch.js 檔案將保留在目錄中)
    ) else (
        echo [ERROR] 修補執行失敗，請檢查上方錯誤訊息。
    )
) else (
    echo [OK] 無須修補 (未偵測到 patch.js)。
)
echo.

goto finish

:finish
echo.
echo ==========================================================
echo [OK] 安裝完成！(v8.5 Neuro-Link Edition)
echo [>] 啟動命令：
echo    - 標準模式: npm start
echo    - 戰術面板: npm start dashboard
echo ==========================================================
pause
