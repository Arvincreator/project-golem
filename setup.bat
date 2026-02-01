@echo off
setlocal
chcp 65001 >nul
title Golem v7.5 Setup (Hydra Dual-Link) - Pure Installer

echo ========================================================
echo   🦞 Golem v7.5 環境部署工具
echo   目標：Telegram + Discord 雙平台環境
echo   注意：本腳本僅安裝環境，請確保您已放入原始碼！
echo ========================================================
echo.

:: 1. 檢查 Node.js 環境
echo 🔍 [1/6] 正在檢查 Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 未偵測到 Node.js！
    echo 請前往 https://nodejs.org/ 下載並安裝。
    pause
    exit /b
)
echo    ✅ Node.js 已就緒。

:: 2. 檢查使用者提供的原始碼 (關鍵步驟)
echo.
echo 📂 [2/6] 驗證核心檔案...
if not exist index.js (
    color 0C
    echo.
    echo [嚴重錯誤] 找不到 index.js！
    echo 請將您完整版的 index.js 放入此資料夾後再執行。
    echo.
    pause
    exit /b
)
if not exist skills.js (
    echo [提示] 找不到 skills.js，若您的 index.js 需要它，請記得放入。
) else (
    echo    ✅ 偵測到 skills.js
)
echo    ✅ 偵測到 index.js (使用您提供的版本)

:: 3. 清理舊環境
echo.
echo 🧹 [3/6] 清理舊依賴...
if exist node_modules (
    echo    - 正在移除舊的 node_modules...
    rmdir /s /q node_modules
)
if exist package-lock.json del package-lock.json
echo    ✅ 環境已清理。

:: 4. 安裝依賴 (包含 V7.5 雙平台所需)
echo.
echo 📦 [4/6] 正在安裝 NPM 依賴...
echo    - 包含: Telegram, Discord.js, Puppeteer, Google AI...
if not exist package.json call npm init -y >nul

:: 安裝指令 (含 discord.js)
call npm install dotenv node-telegram-bot-api discord.js puppeteer puppeteer-extra puppeteer-extra-plugin-stealth @google/generative-ai uuid
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [錯誤] 安裝失敗，請檢查網路連線。
    pause
    exit /b
)
echo    ✅ 依賴安裝完成。

:: 5. 下載瀏覽器核心
echo.
echo 🌐 [5/6] 設定 Puppeteer Chrome 核心...
call npx puppeteer browsers install chrome
echo    ✅ 瀏覽器核心就緒。

:: 6. 初始化設定檔
echo.
echo 🧠 [6/6] 設定環境參數...

if not exist golem_memory mkdir golem_memory

:: 初始化 JSON 記憶體 (若不存在)
if not exist golem_learning.json echo {} > golem_learning.json

:: 建立 V7.5 專用的 .env (若不存在)
if not exist .env (
    echo    - 正在建立 V7.5 雙平台 .env 範本...
    (
        echo # ======================================================
        echo # 🧠 Golem Brain ^(Web Gemini API Keys^)
        echo # ======================================================
        echo # 必填：用於自癒與視覺分析，支援多組 Key 用逗號分隔
        echo GEMINI_API_KEYS=
        echo.
        echo # ======================================================
        echo # ✈️ Telegram 設定 ^(左頭^)
        echo # ======================================================
        echo TELEGRAM_TOKEN=
        echo ADMIN_ID=
        echo.
        echo # ======================================================
        echo # 👾 Discord 設定 ^(右頭^)
        echo # ======================================================
        echo DISCORD_TOKEN=
        echo DISCORD_ADMIN_ID=
        echo.
        echo # ======================================================
        echo # ⚙️ 系統設定
        echo # ======================================================
        echo USER_DATA_DIR=./golem_memory
        echo GOLEM_TEST_MODE=false
    ) > .env
    echo    ⚠️ .env 已建立，請記得填入 Token！
) else (
    echo    ✅ .env 已存在 (跳過覆蓋)。
)

echo.
echo ========================================================
echo      🎉 部署完成！(使用您的自訂代碼)
echo ========================================================
echo.
echo [請執行以下步驟]
echo 1. 編輯 .env 檔案，填入 TG/Discord Token 與 Gemini Key。
echo 2. 啟動機器人: node index.js
echo.
pause
