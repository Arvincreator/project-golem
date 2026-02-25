# =======================================================
# Project Golem v9.0 (Titan Chronos) - 自動化安裝精靈
# PowerShell 版本 - 完整支援 Unicode / 繁體中文
# =======================================================
Set-Location $PSScriptRoot

function Show-Title {
    $Host.UI.RawUI.WindowTitle = 'Project Golem v9.0 Setup (Titan Chronos)'
}

function Show-MainMenu {
    Clear-Host
    Write-Host ''
    Write-Host '=======================================================' -ForegroundColor Cyan
    Write-Host '  Project Golem v9.0 主控制台' -ForegroundColor White
    Write-Host '=======================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  請選擇操作模式：' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  [0] 啟動系統 (TUI 終端機 + Web 儀表板)'
    Write-Host '  -------------------------------------------------------'
    Write-Host '  [1] 完整安裝與部署 (安裝依賴 + 配置 + 編譯)'
    Write-Host '  [2] 僅更新配置 (重新設定 .env)'
    Write-Host '  [3] 僅修復依賴 (重新安裝 npm 套件)'
    Write-Host '  [Q] 離開'
    Write-Host ''
    $choice = Read-Host '請輸入選項 (0/1/2/3/Q)'
    return $choice.Trim().ToUpper()
}

# ─── 讀取 .env 檔案為 hashtable ──────────────────────────
function Read-EnvFile {
    $env_map = @{}
    if (Test-Path '.env') {
        Get-Content '.env' | ForEach-Object {
            if ($_ -match '^([^#=]+)=(.*)$') {
                $env_map[$Matches[1].Trim()] = $Matches[2].Trim()
            }
        }
    }
    return $env_map
}

# ─── 更新 .env 中的某個 Key ──────────────────────────────
function Update-Env {
    param([string]$Key, [string]$Value)
    if (-not (Test-Path '.env')) { '' | Set-Content '.env' -Encoding UTF8 }
    $file_lines = Get-Content '.env' -Encoding UTF8
    $found = $false
    $new_lines = $file_lines | ForEach-Object {
        if ($_ -match "^$Key=") {
            "$Key=$Value"
            $found = $true
        }
        else { $_ }
    }
    if (-not $found) { $new_lines += "$Key=$Value" }
    $new_lines | Set-Content '.env' -Encoding UTF8
}

# ─── Step 1: 核心檔案檢查 ────────────────────────────────
function Step-CheckFiles {
    Write-Host ''
    Write-Host '[1/6] 正在檢查核心檔案完整性...' -ForegroundColor Cyan
    $files = @('index.js', 'skills.js', 'package.json', 'dashboard.js')
    $missing = @()
    foreach ($f in $files) {
        if (-not (Test-Path $f)) { $missing += $f }
    }
    if ($missing.Count -gt 0) {
        Write-Host '   [ERROR] 嚴重錯誤：核心檔案遺失！' -ForegroundColor Red
        Write-Host "   缺失檔案: $($missing -join ', ')" -ForegroundColor Red
        Write-Host '   請確保您已完整解壓縮 V9.0 檔案包。' -ForegroundColor Red
        Read-Host '按 Enter 返回主選單'
        return $false
    }
    Write-Host '   [OK] 核心檔案檢查通過。' -ForegroundColor Green
    return $true
}

# ─── Step 2: Node.js 環境檢查 ────────────────────────────
function Step-CheckNode {
    Write-Host ''
    Write-Host '[2/6] 正在檢查 Node.js 環境...' -ForegroundColor Cyan
    $node_ver = node -v 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $node_ver) {
        Write-Host '   [WARN] 未檢測到 Node.js，嘗試使用 Winget 自動安裝...' -ForegroundColor Yellow
        winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Host '   [ERROR] 自動安裝失敗。請手動下載安裝 Node.js。' -ForegroundColor Red
            Read-Host '按 Enter 離開'
            return $false
        }
        Write-Host '   [OK] Node.js 安裝成功！請重新啟動此腳本。' -ForegroundColor Green
        Read-Host '按 Enter 離開'
        return $false
    }
    Write-Host "   [OK] Node.js 環境已就緒。($node_ver)" -ForegroundColor Green
    return $true
}

# ─── Step 3: 環境設定檔檢查 ─────────────────────────────
function Step-CheckEnv {
    Write-Host ''
    Write-Host '[3/6] 正在檢查環境設定檔...' -ForegroundColor Cyan
    if (-not (Test-Path '.env')) {
        if (Test-Path '.env.example') {
            Copy-Item '.env.example' '.env'
            Write-Host '   [OK] 已從範本建立 .env 檔案。' -ForegroundColor Green
        }
        else {
            Write-Host '   [ERROR] 找不到 .env.example，跳過配置步驟。' -ForegroundColor Red
            return $false
        }
    }
    else {
        Write-Host '   [OK] .env 檔案已存在。' -ForegroundColor Green
    }
    return $true
}

# ─── Step 3b: 配置精靈 ──────────────────────────────────
function Start-ConfigWizard {
    param([switch]$FromMenu)
    Clear-Host
    Write-Host ''
    Write-Host '=======================================================' -ForegroundColor Cyan
    Write-Host '  環境變數配置精靈 (.env)' -ForegroundColor White
    Write-Host '=======================================================' -ForegroundColor Cyan
    Write-Host '  提示: 直接按 Enter 可保留目前設定值' -ForegroundColor DarkGray
    Write-Host ''
    $old = Read-EnvFile

    # [1/4] Gemini
    Write-Host '[1/4] Google Gemini API Keys (必填)' -ForegroundColor Yellow
    Write-Host "      目前: $($old['GEMINI_API_KEYS'])" -ForegroundColor DarkGray
    do {
        $input_val = Read-Host '>> 請輸入 Keys (多組請用逗號分隔，留空保留)'
        if ([string]::IsNullOrWhiteSpace($input_val)) { $input_val = $old['GEMINI_API_KEYS'] }
        if ([string]::IsNullOrWhiteSpace($input_val)) { Write-Host '   [ERROR] 此欄位為必填！' -ForegroundColor Red }
    } while ([string]::IsNullOrWhiteSpace($input_val))
    Update-Env 'GEMINI_API_KEYS' $input_val

    # [2/4] Telegram
    Write-Host ''
    Write-Host '[2/4] Telegram Bot 設定 (必填)' -ForegroundColor Yellow
    Write-Host '  -------------------------------------------------------'
    Write-Host "      目前 Token: $($old['TELEGRAM_TOKEN'])" -ForegroundColor DarkGray
    do {
        $input_val = Read-Host '>> 請輸入 Bot Token (留空保留)'
        if ([string]::IsNullOrWhiteSpace($input_val)) { $input_val = $old['TELEGRAM_TOKEN'] }
        if ([string]::IsNullOrWhiteSpace($input_val)) { Write-Host '   [ERROR] 此欄位為必填！' -ForegroundColor Red }
    } while ([string]::IsNullOrWhiteSpace($input_val))
    Update-Env 'TELEGRAM_TOKEN' $input_val

    Write-Host "      目前 Admin ID: $($old['ADMIN_ID'])" -ForegroundColor DarkGray
    do {
        $input_val = Read-Host '>> 請輸入管理員 User ID (留空保留)'
        if ([string]::IsNullOrWhiteSpace($input_val)) { $input_val = $old['ADMIN_ID'] }
        if ([string]::IsNullOrWhiteSpace($input_val)) { Write-Host '   [ERROR] 此欄位為必填！' -ForegroundColor Red }
    } while ([string]::IsNullOrWhiteSpace($input_val))
    Update-Env 'ADMIN_ID' $input_val

    # [3/4] Discord
    Write-Host ''
    Write-Host '[3/4] Discord Bot 設定 (選擇性)' -ForegroundColor Yellow
    Write-Host '  -------------------------------------------------------'
    Write-Host "      目前 Token: $($old['DISCORD_TOKEN'])" -ForegroundColor DarkGray
    $input_val = Read-Host '>> 請輸入 Discord Token (留空保留 / 跳過請輸入 none)'
    if ([string]::IsNullOrWhiteSpace($input_val)) { $input_val = $old['DISCORD_TOKEN'] }
    if ($input_val -ine 'none' -and -not [string]::IsNullOrWhiteSpace($input_val)) { Update-Env 'DISCORD_TOKEN' $input_val }

    Write-Host "      目前 Admin ID: $($old['DISCORD_ADMIN_ID'])" -ForegroundColor DarkGray
    $input_val = Read-Host '>> 請輸入 Discord 管理員 ID (留空保留 / 跳過請輸入 none)'
    if ([string]::IsNullOrWhiteSpace($input_val)) { $input_val = $old['DISCORD_ADMIN_ID'] }
    if ($input_val -ine 'none' -and -not [string]::IsNullOrWhiteSpace($input_val)) { Update-Env 'DISCORD_ADMIN_ID' $input_val }

    # [4/4] Web Dashboard
    Write-Host ''
    Write-Host '[4/4] Web Dashboard 設定' -ForegroundColor Yellow
    Write-Host '  -------------------------------------------------------'
    Write-Host "      目前狀態: $($old['ENABLE_WEB_DASHBOARD'])" -ForegroundColor DarkGray
    $input_val = Read-Host '>> 是否啟用 Web Dashboard? (y/n, 留空保留)'
    if ($input_val -ieq 'y') { Update-Env 'ENABLE_WEB_DASHBOARD' 'true' }
    elseif ($input_val -ieq 'n') { Update-Env 'ENABLE_WEB_DASHBOARD' 'false' }

    Write-Host ''
    Write-Host '   [OK] 配置已儲存。' -ForegroundColor Green
    if ($FromMenu) { Read-Host '按 Enter 返回主選單' }
}

# ─── Step 4: 安裝核心依賴 ────────────────────────────────
function Step-InstallCore {
    Write-Host ''
    Write-Host '[4/6] 正在安裝後端核心依賴...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host '   [ERROR] npm install 失敗，請檢查網路連線。' -ForegroundColor Red
        Read-Host '按 Enter 返回主選單'
        return $false
    }
    Write-Host ''
    Write-Host '   [*] 正在驗證 Dashboard TUI 套件...' -ForegroundColor DarkGray
    if (-not (Test-Path 'node_modules\blessed')) { npm install blessed blessed-contrib }
    Write-Host '   [OK] 核心依賴準備就緒。' -ForegroundColor Green
    return $true
}

# ─── Step 5: Web Dashboard 建置 ─────────────────────────
function Step-InstallDashboard {
    Write-Host ''
    Write-Host '[5/6] 正在設定 Web Dashboard...' -ForegroundColor Cyan
    if (-not (Test-Path 'web-dashboard')) {
        Write-Host '   [WARN] 找不到 web-dashboard 目錄，跳過編譯步驟。' -ForegroundColor Yellow
        return
    }
    Write-Host '   [*] 偵測到 web-dashboard 目錄。' -ForegroundColor DarkGray
    Write-Host '   [*] 正在安裝前端依賴 (這可能需要幾分鐘)...' -ForegroundColor DarkGray
    Push-Location 'web-dashboard'
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host '   [WARN] 前端依賴安裝失敗，Web 介面可能無法使用。' -ForegroundColor Yellow
        Pop-Location; return
    }
    Write-Host '   [*] 正在編譯 Next.js 應用程式...' -ForegroundColor DarkGray
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host '   [WARN] 編譯失敗。Web 介面可能無法存取。' -ForegroundColor Yellow
    }
    else {
        Write-Host '   [OK] Web Dashboard 編譯成功。' -ForegroundColor Green
    }
    Pop-Location
}

# ─── Step 6: 完成畫面 ────────────────────────────────────
function Step-Final {
    Clear-Host
    Write-Host ''
    Write-Host '=======================================================' -ForegroundColor Green
    Write-Host '  部署成功！ (Project Golem v9.0 Titan)' -ForegroundColor Green
    Write-Host '=======================================================' -ForegroundColor Green
    Write-Host ''
    Write-Host '  系統已準備就緒。'
    Write-Host ''
    Write-Host '  [Y] 立即啟動系統'
    Write-Host '  [N] 返回主選單'
    Write-Host ''
    Write-Host '  系統將在 10 秒後自動啟動... (按 Y/N 可提前選擇)' -ForegroundColor DarkGray
    $launch = $true
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 10) {
        if ([Console]::KeyAvailable) {
            $k = [Console]::ReadKey($true)
            if ($k.KeyChar -ieq 'n') { $launch = $false; break }
            if ($k.KeyChar -ieq 'y') { break }
        }
        Start-Sleep -Milliseconds 100
    }
    if ($launch) { Launch-System }
}

# ─── 啟動系統 ────────────────────────────────────────────
function Launch-System {
    Clear-Host
    Write-Host ''
    Write-Host '=======================================================' -ForegroundColor Cyan
    Write-Host '  正在啟動 Golem v9.0...' -ForegroundColor Cyan
    Write-Host '=======================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  [INFO] 正在載入神經記憶體與儀表板...'
    Write-Host '  [INFO] Web 介面網址: http://localhost:3000' -ForegroundColor Cyan
    Write-Host '  [TIPS] 若要離開，請按 q 或 Ctrl+C。' -ForegroundColor DarkGray
    Write-Host ''
    npm run dashboard
    Write-Host ''
    Write-Host '  [INFO] 系統已停止。'
    Read-Host '按 Enter 返回主選單'
}

# ─── 完整安裝流程 ────────────────────────────────────────
function Run-FullInstall {
    if (-not (Step-CheckFiles)) { return }
    if (-not (Step-CheckNode)) { return }
    $null = Step-CheckEnv
    Start-ConfigWizard
    if (-not (Step-InstallCore)) { return }
    Step-InstallDashboard
    Step-Final
}

# =======================================================
# 主程式入口
# =======================================================
Show-Title
while ($true) {
    $choice = Show-MainMenu
    switch ($choice) {
        '0' { Launch-System }
        '1' { Run-FullInstall }
        '2' { $null = Step-CheckEnv; Start-ConfigWizard -FromMenu }
        '3' { Step-InstallCore; Read-Host '按 Enter 返回主選單' }
        'Q' { exit 0 }
        default { Write-Host '  無效選項，請重新輸入。' -ForegroundColor Red; Start-Sleep 1 }
    }
}
