# Windows Utility Functions for PowerShell
# Pure ASCII for maximum global compatibility

$SCRIPT:BACKGROUND_PIDS = @()

# Character codes for UI symbols
$S_LBRAC = [char]0x005B # [
$S_RBRAC = [char]0x005D # ]
$S_WARN  = [char]0x26A0 # Warning symbol

# Chinese Message Fragments (Concatenated char codes)
$MSG_CONFIRM = [char]0x78BA + [char]0x8a8d + [char]0x57f7 + [char]0x884c + [char]0xFF1F

function Register-Pid { param($pid) $SCRIPT:BACKGROUND_PIDS += $pid }
function Cleanup-Pids { foreach ($p in $SCRIPT:BACKGROUND_PIDS) { Stop-Process -Id $p -ErrorAction SilentlyContinue } }

function Log {
    param($msg)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$timestamp] $msg" | Out-File -FilePath $LOG_FILE -Append
}

function Update-Env {
    param($key, $val)
    if (-not (Test-Path $DOT_ENV_PATH)) { New-Item -ItemType File -Path $DOT_ENV_PATH | Out-Null }
    $content = Get-Content $DOT_ENV_PATH
    if ($content -match "^$key=") { $content = $content -replace "^$key=.*", "$key=$val" }
    else { $content += "$key=$val" }
    $content | Set-Content $DOT_ENV_PATH
    Log "Updated env: $key"
}

function Confirm-Action {
    param($msg = $MSG_CONFIRM)
    Write-Host "`n  $S_WARN $msg (Y/N) " -ForegroundColor Yellow -NoNewline
    $key = Read-Host
    if ($key -and $key.Trim().ToUpper() -eq "Y") { return $true }
    return $false
}

function Prompt-SingleSelect {
    param($prompt, $options)
    Write-Host "`n  $prompt" -ForegroundColor White
    $cursor = 0; $num_options = $options.Count
    function Print-Menu {
        param($current_cursor)
        for ($i=0; $i -lt $num_options; $i++) {
            $opt = $options[$i].Split('|')
            $key = $opt[0]; $desc = $opt[1]
            if ($i -eq $current_cursor) {
                Write-Host "  > " -NoNewline -ForegroundColor Cyan
                Write-Host "$S_LBRAC" -NoNewline -ForegroundColor Green
                Write-Host "X" -NoNewline -ForegroundColor Green
                Write-Host "$S_RBRAC " -NoNewline -ForegroundColor Green
                Write-Host "$key " -NoNewline -ForegroundColor White
                Write-Host "$desc" -ForegroundColor Cyan
            } else {
                Write-Host "    " -NoNewline -ForegroundColor Gray
                Write-Host "$S_LBRAC $S_RBRAC " -NoNewline -ForegroundColor Gray
                Write-Host "$key " -NoNewline -ForegroundColor White
                Write-Host "$desc" -ForegroundColor Gray
            }
        }
        $moveLab = [char]0x2191 + "/" + [char]0x2193 + ": " + [char]0x79fb + [char]0x52d5
        $confirmLab = "Enter: " + [char]0x78ba + [char]0x8a8d
        Write-Host "  ($moveLab, $confirmLab)" -ForegroundColor Gray
    }
    Print-Menu $cursor
    while ($true) {
        $keyInfo = [System.Console]::ReadKey($true)
        if ($keyInfo.Key -eq [System.ConsoleKey]::UpArrow) { $cursor = ($cursor - 1 + $num_options) % $num_options }
        elseif ($keyInfo.Key -eq [System.ConsoleKey]::DownArrow) { $cursor = ($cursor + 1) % $num_options }
        elseif ($keyInfo.Key -eq [System.ConsoleKey]::Enter) { break }
        for ($i=0; $i -lt ($num_options + 1); $i++) {
            [System.Console]::SetCursorPosition(0, [System.Console]::CursorTop - 1)
            [System.Console]::Write(" " * [System.Console]::WindowWidth)
            [System.Console]::SetCursorPosition(0, [System.Console]::CursorTop)
        }
        Print-Menu $cursor
    }
    $SCRIPT:SINGLESELECT_RESULT = $options[$cursor].Split('|')[0]
}

function Get-Tagline {
    $t1 = [char]0x60a8 + [char]0x7684 + [char]0x500b + [char]0x4eba + " AI " + [char]0x52a9 + [char]0x7406 + [char]0xff0c + [char]0x96a8 + [char]0x6642 + [char]0x9810 + [char]0x5099 + [char]0x5c31 + [char]0x7ddb + [char]0x3002
    $t2 = [char]0x4e3b + [char]0x6a5f + [char]0x9023 + [char]0x7dda + [char]0x7a69 + [char]0x5b9a + [char]0xff0c + [char]0x6240 + [char]0x6709 + [char]0x7cfb + [char]0x7d71 + [char]0x904b + [char]0x884c + [char]0x6b63 + [char]0x5e38 + [char]0x3002
    $t3 = [char]0x63d0 + [char]0x793a + [char]0xff1a + [char]0x82e5 + [char]0x9047 + [char]0x5230 + [char]0x901a + [char]0x8a0a + [char]0x57e0 + [char]0x885d + [char]0x7a81 + [char]0xff0c + [char]0x8acb + [char]0x4f7f + [char]0x7528 + " 'Doctor' " + [char]0x9032 + [char]0x884c + [char]0x8a3a + [char]0x65b7 + [char]0x3002
    $t4 = [char]0x795e + [char]0x7d93 + [char]0x8e4a + [char]0x8def + [char]0x5df2 + [char]0x5efa + [char]0x7acb + [char]0xff0c + [char]0x4b7f + [char]0x6240 + " Golem " + [char]0x6838 + [char]0x5fc3 + [char]0x5df2 + [char]0x555f + [char]0x52d5 + [char]0x3002
    $tips = @($t1, $t2, $t3, $t4)
    return $tips[(Get-Random -Maximum $tips.Count)]
}
