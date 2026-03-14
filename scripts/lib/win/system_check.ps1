# Windows System Check Functions for PowerShell
# Strict ASCII for global compatibility

function Check-Status {
    $SCRIPT:NODE_VER = "N/A"
    try {
        $SCRIPT:NODE_VER = node -v 2>$null
        $nodeMaj = [int]($SCRIPT:NODE_VER -replace '^v(\d+)\..*', '$1')
        $okLab = [char]0x6b63 + [char]0x5e38
        $errLab = [char]0x7248 + [char]0x672c + [char]0x4e0d + [char]0x7b26
        if ($nodeMaj -eq 20) { $SCRIPT:STATUS_NODE = $okLab; $SCRIPT:NODE_OK = $true }
        else { $SCRIPT:STATUS_NODE = $errLab; $SCRIPT:NODE_OK = $false }
    } catch { 
        $SCRIPT:NODE_OK = $false
        $SCRIPT:STATUS_NODE = [char]0x7f3a + [char]0x5931
    }

    $setLab = [char]0x5df2 + [char]0x8a2d + [char]0x5b9a
    $missLab = [char]0x672a + [char]0x627e + [char]0x5230
    if (Test-Path $DOT_ENV_PATH) { $SCRIPT:STATUS_ENV = $setLab; $SCRIPT:ENV_OK = $true }
    else { $SCRIPT:STATUS_ENV = $missLab; $SCRIPT:ENV_OK = $false }

    $enLab = [char]0x555f + [char]0x7528
    $disLab = [char]0x505c + [char]0x7528
    $SCRIPT:IsDashEnabled = $false
    if (Test-Path $DOT_ENV_PATH) {
        $dash_env = Select-String -Path $DOT_ENV_PATH -Pattern "^ENABLE_WEB_DASHBOARD=true"
        if ($dash_env -or (Test-Path (Join-Path $SCRIPT_DIR "web-dashboard"))) { 
            $SCRIPT:IsDashEnabled = $true; $SCRIPT:STATUS_DASH = $enLab 
        } else { $SCRIPT:STATUS_DASH = $disLab }
    }

    $SCRIPT:IS_RUNNING = $false
    $SCRIPT:STATUS_RUNNING = [char]0x25cb + " " + [char]0x505c + [char]0x6b62
    $procs = Get-Process node -ErrorAction SilentlyContinue | Where-Object { 
        try { ($_.CommandLine -like "*index.js*" -or $_.CommandLine -like "*dashboard*") -and ($_.Path -notmatch "Code\.exe") } catch { $false }
    }
    if ($procs) { 
        $SCRIPT:IS_RUNNING = $true
        $SCRIPT:STATUS_RUNNING = [char]0x25cf + " " + [char]0x57f7 + [char]0x884c + [char]0x4e2d 
    }

    try {
        $cpu = (Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        if ($null -eq $cpu) { $cpu = 0 }
        $SCRIPT:SYS_CPU = [int]$cpu
        $mem = Get-WmiObject Win32_OperatingSystem
        $freeMemGB = [Math]::Round($mem.FreePhysicalMemory / 1MB, 1)
        $SCRIPT:SYS_MEM = "$freeMemGB GB"
    } catch { $SCRIPT:SYS_CPU = 0; $SCRIPT:SYS_MEM = "N/A" }
    
    $SCRIPT:SYS_IP = "127.0.0.1"
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*Virtual*" } | Select-Object -First 1
        if ($ip) { $SCRIPT:SYS_IP = $ip.IPAddress }
    } catch {}
    $SCRIPT:SYS_UPTIME = [char]0x5df2 + [char]0x7a69 + [char]0x5b9a + [char]0x904b + [char]0x884c
}

function Show-Status {
    Check-Status
    $repLab = [char]0x7cfb + [char]0x7d71 + [char]0x72c0 + [char]0x614b + [char]0x5831 + [char]0x544a
    Write-Host ("`n  Project Golem v$GOLEM_VERSION - " + $repLab) -ForegroundColor Cyan
    Write-Host "  -----------------------------------------"
    $envLab = [char]0x74b0 + [char]0x5883 + [char]0x8b8a + [char]0x6578
    $dashLab = [char]0x63a7 + [char]0x5236 + [char]0x53f0
    $runLab = [char]0x57f7 + [char]0x884c + [char]0x72c0 + [char]0x614b
    $cpuLab = [char]0x4f7f + [char]0x7528 + [char]0x7387
    $memLab = [char]0x5269 + [char]0x9918 + [char]0x8a18 + [char]0x61b6 + [char]0x9ad4
    $ipLab = [char]0x5340 + [char]0x57df + [char]0x9023 + [char]0x7dda
    Write-Host ("  Node.js:       " + $SCRIPT:NODE_VER + " (" + $SCRIPT:STATUS_NODE + ")")
    Write-Host ("  " + $envLab + ":      " + $SCRIPT:STATUS_ENV)
    Write-Host ("  " + $dashLab + ":        " + $SCRIPT:STATUS_DASH)
    Write-Host ("  " + $runLab + ":      " + $SCRIPT:STATUS_RUNNING)
    Write-Host ("  CPU " + $cpuLab + ":    " + $SCRIPT:SYS_CPU + " %")
    Write-Host ("  " + $memLab + ":    " + $SCRIPT:SYS_MEM)
    Write-Host ("  " + $ipLab + " IP:   " + $SCRIPT:SYS_IP)
    Write-Host ""
}

function Run-Health-Check {
    Write-Host ""
    Box-Top
    $diagLab = [char]0x6df1 + [char]0x5ea6 + [char]0x7cfb + [char]0x7d71 + [char]0x8a3a + [char]0x65b7 + " (Deep Diagnostics)"
    $icon = [char]::ConvertFromUtf32(0x1f3e5)
    Box-Line-Colored ("  " + $icon + " Golem " + $diagLab) "Cyan"
    Box-Sep
    Check-Status
    $coreLab = [char]0x6838 + [char]0x5fc3 + [char]0x74b0 + [char]0x5883
    $fileLab = [char]0x8a2d + [char]0x5b9a + [char]0x6a94 + [char]0x6848
    $portLab = [char]0x901a + [char]0x8a0a + [char]0x57e0
    
    if ($SCRIPT:NODE_OK) { Box-Line-Colored ("  " + $S_CHECK + " " + $coreLab + ": Node.js " + $SCRIPT_NODE_VER) "Green" }
    else { Box-Line-Colored ("  " + $S_CROSS + " " + $coreLab + ": Node.js " + $SCRIPT_NODE_VER) "Red" }
    
    if ($SCRIPT:ENV_OK) { Box-Line-Colored ("  " + $S_CHECK + " " + $fileLab + ": .env FOUND") "Green" }
    else { Box-Line-Colored ("  " + $S_CROSS + " " + $fileLab + ": .env MISSING") "Red" }
    
    $port3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
    if ($port3000) { Box-Line-Colored ("  " + $S_CROSS + " " + $portLab + " 3000: BUSY") "Red" }
    else { Box-Line-Colored ("  " + $S_CHECK + " " + $portLab + " 3000: FREE") "Green" }
    
    Box-Sep
    if ($SCRIPT:NODE_OK -and $SCRIPT:ENV_OK -and -not $port3000) {
        Box-Line-Colored ("  " + [char]0x2714 + " HEALTH NOMINAL") "Green"
    } else {
        Box-Line-Colored ("  " + [char]0x26a0 + " ISSUES DETECTED") "Yellow"
    }
    Box-Bottom; Write-Host ""
}
