# =======================================================
# Project Golem v9.0 (Titan Chronos) - Windows 原生安裝精靈
# PowerShell 版本 - 針對 Windows 資源顯示與介面渲染優化
# =======================================================
Set-Location $PSScriptRoot

# ─── 視覺化輔助效能函式 ────────────────────────────────
function Get-MiniBar {
    param([int]$Percent)
    $width = 10
    $filled = [Math]::Min([Math]::Max([Math]::Round($Percent * $width / 100), 0), $width)
    $empty = $width - $filled
    
    $color = "Green"
    if ($Percent -gt 50) { $color = "Yellow" }
    if ($Percent -gt 85) { $color = "Red" }
    
    $bar = ("■" * $filled) + ("□" * $empty)
    return @{ Bar = $bar; Color = $color }
}

function Show-DashboardHeader {
    Clear-Host
    Write-Host "┌──────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
    
    # 抓取原生系統資訊 (Windows 特化)
    $cpuLoad = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    if ($null -eq $cpuLoad) { $cpuLoad = 0 }
    
    $memInfo = Get-CimInstance Win32_OperatingSystem
    $freeMemGB = [Math]::Round($memInfo.FreePhysicalMemory / 1MB, 1)
    $totalMemGB = [Math]::Round($memInfo.TotalVisibleMemorySize / 1MB, 1)
    $memUsedPercent = [Math]::Round((1 - ($freeMemGB / $totalMemGB)) * 100)
    
    $cpuBar = Get-MiniBar -Percent $cpuLoad
    $memBar = Get-MiniBar -Percent $memUsedPercent
    
    # 介面渲染
    Write-Host "│ " -NoNewline -ForegroundColor Cyan
    Write-Host "狀態: ● 停止" -NoNewline -ForegroundColor Gray
    Write-Host "  位置: 127.0.0.1" -ForegroundColor White
    
    Write-Host "│ " -NoNewline -ForegroundColor Cyan
    Write-Host "硬體: CPU " -NoNewline
    Write-Host $cpuBar.Bar -ForegroundColor $cpuBar.Color -NoNewline
    Write-Host " $($cpuLoad)%" -ForegroundColor Yellow
    Write-Host "                                   │" -ForegroundColor Cyan
    
    Write-Host "│ " -NoNewline -ForegroundColor Cyan
    Write-Host "      MEM " -NoNewline
    Write-Host $memBar.Bar -ForegroundColor $memBar.Color -NoNewline
    Write-Host " $($freeMemGB)GB free" -ForegroundColor Cyan
    Write-Host "                             │" -ForegroundColor Cyan
    
    Write-Host "└──────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
    Write-Host ""
}

# ─── 主選單與邏輯 ──────────────────────────────────────
function Show-MainMenu {
    Show-DashboardHeader
    Write-Host "  ⚡ 核心操作 (Core Operations)" -ForegroundColor Yellow
    Write-Host "  ───────────────────────────────"
    Write-Host "   [0] 🚀 啟動系統 (Power On)"
    Write-Host "   [1] 📦 執行安裝 (Update / Build)"
    Write-Host "   [2] ⚙️ 配置精靈 (Config Wizard)"
    Write-Host "   [Q] 離開 (Exit)"
    Write-Host ""
    $choice = Read-Host "  👉 請輸入選項"
    return $choice.Trim().ToUpper()
}

# (其餘邏輯比照之前 setup.ps1，但保持 UI 正確)
# ... [簡化實作，確保核心啟動功能] ...

function Launch-System {
    Clear-Host
    Write-Host "正在啟動 Golem v9.0..." -ForegroundColor Cyan
    npm run dashboard
}

function Run-FullInstall {
    Write-Host "正在執行完整安裝..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "安裝完成！" -ForegroundColor Green
    }
}

# ─── 執行進入點 ────────────────────────────────────────
$choice = ""
if ($args -contains "--start") { $choice = "0" }
elseif ($args -contains "--install") { $choice = "1" }

if ($choice -eq "") {
    $choice = Show-MainMenu
}

switch ($choice) {
    "0" { Launch-System }
    "1" { Run-FullInstall }
    "2" { Write-Host "配置精靈尚未實作" }
    "Q" { exit 0 }
}
