# Windows Menu System for PowerShell
# Pure ASCII for maximum global compatibility

function Show-Header {
    Check-Status
    Show-Golem-Logo
    Box-Header-Dashboard -Status $SCRIPT:STATUS_RUNNING `
                        -IP $SCRIPT:SYS_IP `
                        -CPU $SCRIPT:SYS_CPU `
                        -MEM $SCRIPT:SYS_MEM `
                        -UPTIME $SCRIPT:SYS_UPTIME `
                        -ENV_STATUS $SCRIPT:STATUS_ENV `
                        -GOLEMS 1 `
                        -DASH_STATUS $SCRIPT:STATUS_DASH `
                        -VERSION $GOLEM_VERSION `
                        -NODE_VER $NODE_VER
}

function Stop-System {
    param($interactive = $true)
    $msg = [char]0x6b63 + [char]0x5728 + [char]0x505c + [char]0x6b62 + [char]0x6240 + [char]0x6709 + " Golem " + [char]0x76f8 + [char]0x95dc + [char]0x7a0b + [char]0x5e8f + "..."
    $icon = [char]::ConvertFromUtf32(0x1F6D1)
    Write-Host ("`n  " + $icon + " " + $msg) -ForegroundColor Yellow
    $procs = Get-Process node -ErrorAction SilentlyContinue | Where-Object { 
        try { ($_.CommandLine -like "*index.js*" -or $_.CommandLine -like "*dashboard*") -and ($_.Path -notmatch "Code\.exe") } catch { $false }
    }
    if ($procs) { 
        $procs | Stop-Process -Force
        $succ = [char]0x6240 + [char]0x6709 + [char]0x7a0b + [char]0x5e8f + [char]0x5df2 + [char]0x6210 + [char]0x529f + [char]0x7d42 + [char]0x6b62 + [char]0x3002
        UI-Success $succ 
    } else { 
        $none = [char]0x76ee + [char]0x524d + [char]0x7121 + [char]0x6b63 + [char]0x5728 + [char]0x57f7 + [char]0x884c + [char]0x7684 + [char]0x7a0b + [char]0x5e8f + [char]0x3002
        UI-Info $none 
    }
    if ($interactive) { 
        $back = [char]0x6309 + " Enter " + [char]0x8fd4 + [char]0x56de + [char]0x4e3b + [char]0x9078 + [char]0x55ae + "..."
        Write-Host ("`n  " + $back) -NoNewline; Read-Host
    }
}

function Launch-System {
    param([string]$authMode = "")
    Check-Status
    if (-not $ENV_OK) { 
        $err = [char]0x74b0 + [char]0x5883 + [char]0x5c1a + [char]0x672a + [char]0x914d + [char]0x7f6e
        UI-Error $err; return 
    }
    Clear-Host; Show-Header; Run-Health-Check
    $startMsg = [char]0x6b63 + [char]0x5728 + [char]0x555f + [char]0x52d5 + " Golem v$GOLEM_VERSION " + [char]0x63a7 + [char]0x5236 + [char]0x53f0 + "..."
    $rocket = [char]::ConvertFromUtf32(0x1F680)
    Write-Host ("`n  " + $rocket + " " + $startMsg) -ForegroundColor Cyan
    $loadMsg = [char]0x6b63 + [char]0x5728 + [char]0x8f09 + [char]0x5165 + " Neural Memory " + [char]0x8207 + [char]0x6230 + [char]0x8853 + [char]0x4ecb + [char]0x9762 + "..."
    Write-Host ("  " + $S_DOT + " " + $loadMsg) -ForegroundColor Gray
    $exitMsg = [char]0x82e5 + [char]0x8981 + [char]0x96e2 + [char]0x958b + [char]0xff0c + [char]0x8acb + [char]0x6309 + " Ctrl+C`n"
    Write-Host ("  " + $S_DOT + " " + $exitMsg) -ForegroundColor Gray
    Start-Sleep -Seconds 1
    if ($authMode) { $env:TG_AUTH_MODE = $authMode }
    npm run dashboard
    $stopMsg = [char]0x7cfb + [char]0x7d71 + [char]0x5df2 + [char]0x505c + [char]0x6b62 + [char]0x3002
    Write-Host ("`n  [INFO] " + $stopMsg) -ForegroundColor Yellow
    $back = [char]0x6309 + " Enter " + [char]0x8fd4 + [char]0x56de + [char]0x4e3b + [char]0x9078 + [char]0x55ae + "..."
    Write-Host ("  " + $back) -NoNewline; Read-Host
}

function Run-Full-Install {
    $instMsg = [char]0x6b63 + [char]0x5728 + [char]0x958b + [char]0x59cb + [char]0x5b8c + [char]0x6574 + [char]0x5b89 + [char]0x88dd + [char]0x6d41 + [char]0x7a0b + "..."
    $box = [char]::ConvertFromUtf32(0x1F4E6)
    Write-Host ("`n  " + $box + " " + $instMsg) -ForegroundColor Cyan
    if (-not (Test-Path $DOT_ENV_PATH)) {
        $envMsg = [char]0x6b63 + [char]0x5728 + [char]0x5f9e + [char]0x7bc4 + [char]0x4f8b + [char]0x6a94 + [char]0x6848 + [char]0x5efa + [char]0x7acb + " .env..."
        UI-Info $envMsg
        if (Test-Path ".env.example") { Copy-Item ".env.example" ".env" }
        else { New-Item -ItemType File -Path $DOT_ENV_PATH | Out-Null }
    }
    $npmMsg = [char]0x6b63 + [char]0x5728 + [char]0x900f + [char]0x904e + " npm " + [char]0x5b89 + [char]0x88dd + [char]0x4f9d + [char]0x8cf4 + [char]0x5957 + [char]0x4ef6 + "..."
    UI-Info $npmMsg
    npm install
    $doneMsg = [char]0x5b89 + [char]0x88dd + [char]0x8207 + [char]0x74b0 + [char]0x5883 + [char]0x5efa + [char]0x7f6e + [char]0x5b8c + [char]0x6210 + [char]0x3002
    UI-Success $doneMsg
    $back = [char]0x6309 + " Enter " + [char]0x8fd4 + [char]0x56de + [char]0x4e3b + [char]0x9078 + [char]0x55ae + "..."
    Write-Host ("  " + $back) -NoNewline; Read-Host
}

function Run-Config-Wizard {
    $wizTitle = [char]0x914d + [char]0x7f6e + [char]0x7cbe + [char]0x9748 + " (Config Wizard)"
    Write-Host ("`n  " + [char]::ConvertFromUtf32(0x1f4dd) + " " + $wizTitle) -ForegroundColor Cyan
    if (-not (Test-Path $DOT_ENV_PATH)) {
        if (Test-Path ".env.example") { Copy-Item ".env.example" ".env" }
        else { New-Item -ItemType File -Path $DOT_ENV_PATH | Out-Null }
    }
    $keyPrompt = [char]0x8acb + [char]0x8f38 + [char]0x5165 + " Gemini API Key: "
    $key = Read-Host "  $keyPrompt"
    if ($key) { Update-Env "GEMINI_API_KEY" $key }
    UI-Success ([char]0x8a2d + [char]0x5b9a + [char]0x5df2 + [char]0x5132 + [char]0x5b58 + [char]0x3002)
    Write-Host ("  " + [char]0x6309 + " Enter " + [char]0x8fd4 + [char]0x56de + [char]0x4e3b + [char]0x9078 + [char]0x55ae + "...") -NoNewline; Read-Host
}

function Show-Menu {
    while ($true) {
        Clear-Host; Show-Header
        $coreOps = [char]0x6838 + [char]0x5fc3 + [char]0x64cd + [char]0x4f5c
        Write-Host ("`n  " + [char]0x26a1 + " " + $coreOps + " (Core Operations)") -ForegroundColor Yellow
        $sepStart = [char]0x2514; $sepEnd = [char]0x2518; $sepMid = New-Object string ([char]0x2500, 43)
        Write-Host ("  " + $sepStart + $sepMid + $sepEnd) -ForegroundColor Gray
        
        $options = @(
            ("Start|" + [char]::ConvertFromUtf32(0x1f680) + " " + [char]0x555f + [char]0x52d5 + [char]0x7cfb + [char]0x7d71 + [char]0x8207 + [char]0x63a7 + [char]0x5236 + [char]0x53f0 + " (Power On)"),
            ("Stop|" + [char]::ConvertFromUtf32(0x1f6d1) + " " + [char]0x95dc + [char]0x9589 + [char]0x6240 + [char]0x6709 + " Golem " + [char]0x7a0b + [char]0x5e8f + " (Shutdown)"),
            ("Install|" + [char]::ConvertFromUtf32(0x1f4e6) + " " + [char]0x66f4 + [char]0x65b0 + [char]0x4f9d + [char]0x8cf4 + [char]0x8207 + [char]0x7cfb + [char]0x7d71 + [char]0x5efa + [char]0x7f6e + " (Update / Build)"),
            ("Config|" + [char]::ConvertFromUtf32(0x1f4dd) + " " + [char]0x914d + [char]0x7f6e + [char]0x7cbe + [char]0x9748 + " (Configuration Wizard)"),
            ("Doctor|" + [char]::ConvertFromUtf32(0x1f3e5) + " " + [char]0x6df1 + [char]0x5ea6 + [char]0x7cfb + [char]0x7d71 + [char]0x8a3a + [char]0x65b7 + " (Run Diagnostics)"),
            ("Clean|" + [char]::ConvertFromUtf32(0x1f9f9) + " " + [char]0x6e05 + [char]0x9664 + [char]0x4f9d + [char]0x8cf4 + " (Clean node_modules)"),
            ("Init|" + [char]::ConvertFromUtf32(0x1f9e8) + " " + [char]0x5b8c + [char]0x5168 + [char]0x521d + [char]0x59cb + [char]0x5316 + [char]0x7cfb + [char]0x7d71 + " (Factory Reset - DANGER)"),
            ("Quit|" + [char]::ConvertFromUtf32(0x1f6aa) + " " + [char]0x9000 + [char]0x51fa + [char]0x4ecb + [char]0x9762 + " (Exit)")
        )

        $maintTools = [char]0x7dad + [char]0x8b77 + [char]0x8207 + [char]0x8a3a + [char]0x65b7
        Write-Host ("`n  " + [char]::ConvertFromUtf32(0x1f6e0) + " " + $maintTools + " (Maintenance & Tools)") -ForegroundColor Cyan
        Write-Host ("  " + $sepStart + $sepMid + $sepEnd) -ForegroundColor Gray
        
        $tip = Get-Tagline
        $tipLab = [char]0x63d0 + [char]0x793a
        Write-Host ("`n  " + [char]::ConvertFromUtf32(0x1f4a1) + " " + $tipLab + ": " + $tip) -ForegroundColor Gray
        $prompt = [char]0x8acb + [char]0x9078 + [char]0x64c7 + [char]0x64cd + [char]0x4f5c + [char]0x9805 + [char]0x76ee + [char]0xff1a
        Prompt-SingleSelect $prompt $options
        $choice = $SCRIPT:SINGLESELECT_RESULT

        switch ($choice) {
            "Start"   { Launch-System; break }
            "Stop"    { Stop-System; break }
            "Install" { Run-Full-Install; break }
            "Config"  { Run-Config-Wizard; break }
            "Doctor"  { Run-Health-Check; $back = [char]0x6309 + " Enter " + [char]0x8fd4 + [char]0x56de + [char]0x4e3b + [char]0x9078 + [char]0x55ae + "..."; Write-Host ("  " + $back) -NoNewline; Read-Host; break }
            "Clean"   { if (Confirm-Action "DELETE node_modules?") { Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue; UI-Success "CLEANED." }; break }
            "Init"    { if (Confirm-Action "FACTORY RESET?") { Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue; UI-Success "RESET COMPLETE." }; break }
            "Quit"    { 
                $bye = [char]0x95dc + [char]0x9589 + [char]0x9023 + [char]0x7dda + [char]0xff0c + [char]0x518d + [char]0x898b + [char]0x0021
                Write-Host ("`n  " + [char]0x2705 + " " + $bye) -ForegroundColor Green; exit 0 
            }
        }
    }
}
