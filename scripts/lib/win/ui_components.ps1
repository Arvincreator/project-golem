# Windows UI Components for PowerShell
# Encoding: UTF-8 BOM
$SCRIPT:BOX_WIDTH = 60

# Special characters as char codes to avoid parser encoding errors
$S_TOP_L = [char]0x250C # ┌
$S_TOP_R = [char]0x2510 # ┐
$S_BOT_L = [char]0x2514 # └
$S_BOT_R = [char]0x2518 # ┘
$S_SEP_L = [char]0x251C # ├
$S_SEP_R = [char]0x2524 # ┤
$S_HOR   = [char]0x2500 # ─
$S_VER   = [char]0x2502 # │
$S_DOT   = [char]0x2022 # •
$S_BLOCK = [char]0x2588 # █
$S_EMPTY = [char]0x2591 # ░
$S_CHECK = [char]0x2714 # ✔
$S_CROSS = [char]0x2718 # ✘
$S_WARN  = [char]0x26A0 # ⚠
$S_INFO  = [char]0x2139 # ℹ
$S_LBRAC = [char]0x005B # [
$S_RBRAC = [char]0x005D # ]

function Box-Top {
    $line = New-Object string ($S_HOR, $SCRIPT:BOX_WIDTH)
    Write-Host "$S_TOP_L$line$S_TOP_R" -ForegroundColor Cyan
}

function Box-Bottom {
    $line = New-Object string ($S_HOR, $SCRIPT:BOX_WIDTH)
    Write-Host "$S_BOT_L$line$S_BOT_R" -ForegroundColor Cyan
}

function Box-Sep {
    $line = New-Object string ($S_HOR, $SCRIPT:BOX_WIDTH)
    Write-Host "$S_SEP_L$line$S_SEP_R" -ForegroundColor Cyan
}

function Get-Visible-Len {
    param([string]$text)
    $len = 0
    foreach ($char in $text.ToCharArray()) {
        if ([int]$char -gt 127) { $len += 2 }
        else { $len += 1 }
    }
    return $len
}

function Box-Line-Colored {
    param([string]$text, [string]$color = "White")
    $vlen = Get-Visible-Len -text $text
    $padding = $SCRIPT:BOX_WIDTH - $vlen - 2
    if ($padding -lt 0) { $padding = 0 }
    
    Write-Host "$S_VER " -NoNewline -ForegroundColor Cyan
    Write-Host $text -NoNewline -ForegroundColor $color
    Write-Host (" " * $padding) -NoNewline
    Write-Host " $S_VER" -ForegroundColor Cyan
}

function Get-Mini-Bar {
    param([int]$Percent)
    $width = 10
    $filled_count = [Math]::Min([Math]::Max([Math]::Round($Percent * $width / 100), 0), $width)
    $empty_count = $width - $filled_count
    
    $color = "Green"
    if ($Percent -gt 50) { $color = "Yellow" }
    if ($Percent -gt 85) { $color = "Red" }
    
    $filled = New-Object string ([char]0x25A0, $filled_count) # ■
    $empty = New-Object string ([char]0x25A1, $empty_count) # □
    
    return @{ Bar = $filled + $empty; Color = $color }
}

function Show-Golem-Logo {
    $c1 = "Cyan"; $c2 = "Blue"; $c3 = "Yellow"; $c4 = "White"
    $b = [char]0x2588 # █
    $t = [char]0x25E2 # ◢
    $tr = [char]0x25E3 # ◣
    $bl = [char]0x25E5 # ◥
    $br = [char]0x25E4 # ◤

    Write-Host ("           $t" + (New-Object string ($b, 11)) + "$tr") -ForegroundColor $c1
    Write-Host ("        $t" + (New-Object string ($b, 3)) + "$br         $bl" + (New-Object string ($b, 3)) + "$tr") -ForegroundColor $c1
    Write-Host ("      $t" + (New-Object string ($b, 2)) + "$br    $t" + (New-Object string ($S_HOR, 4)) + "$tr    $bl" + (New-Object string ($b, 2)) + "$tr") -ForegroundColor $c1
    Write-Host "      $b$b " -NoNewline -ForegroundColor $c2
    Write-Host " $S_LBRAC o - o $S_RBRAC " -NoNewline -ForegroundColor $c3
    Write-Host " $b$b" -ForegroundColor $c2
    Write-Host ("      $bl" + (New-Object string ($b, 2)) + "$tr    $bl" + (New-Object string ($S_HOR, 4)) + "$br    $t" + (New-Object string ($b, 2)) + "$br") -ForegroundColor $c1
    Write-Host ("        $bl" + (New-Object string ($b, 3)) + "$tr         $t" + (New-Object string ($b, 3)) + "$br") -ForegroundColor $c1
    Write-Host ("           $bl" + (New-Object string ($b, 11)) + "$br") -ForegroundColor $c1
    Write-Host "           GOLEM PROJECT   " -ForegroundColor $c4
}

function Box-Header-Dashboard {
    param($Status, $IP, $CPU, $MEM, $UPTIME, $ENV_STATUS, $GOLEMS, $DASH_STATUS, $VERSION, $NODE_VER)
    
    $cpuBarInfo = Get-Mini-Bar -Percent $CPU
    $memPercent = 20
    $memBarInfo = Get-Mini-Bar -Percent $memPercent
    
    $stateLab = [char]0x72c0 + [char]0x614b
    $posLab = [char]0x4f4d + [char]0x7f6e
    $hwLab = [char]0x786c + [char]0x9ad4
    $execLab = [char]0x57f7 + [char]0x884c
    $confLab = [char]0x914d + [char]0x7f6e
    $entityLab = [char]0x5be6 + [char]0x9ad4
    $webLab = [char]0x7db2 + [char]0x9801
    $ctrlLab = [char]0x63a7 + [char]0x5236 + [char]0x53f0
    $verLab = [char]0x6838 + [char]0x5fc3 + [char]0x7248 + [char]0x672c

    Box-Top
    Box-Line-Colored ("  " + $stateLab + ": $Status $S_DOT " + $posLab + ": $IP") "White"
    Box-Line-Colored ("  " + $hwLab + ": CPU $S_LBRAC$($cpuBarInfo.Bar)$S_RBRAC $CPU%") $cpuBarInfo.Color
    Box-Line-Colored ("        MEM $S_LBRAC$($memBarInfo.Bar)$S_RBRAC $MEM free") $memBarInfo.Color
    Box-Line-Colored ("  " + $execLab + ": $UPTIME $S_DOT " + $confLab + ": $ENV_STATUS") "White"
    Box-Line-Colored ("  " + $entityLab + ": $GOLEMS Golems $S_DOT " + $webLab + ": $DASH_STATUS") "White"
    Box-Line-Colored ("  " + $ctrlLab + ": http://$IP:3000") "Cyan"
    Box-Bottom
    Write-Host ("  NODE_NAME: $($env:COMPUTERNAME) $S_DOT " + $verLab + ": v$VERSION $S_DOT Node.js: $NODE_VER") -ForegroundColor Gray
}

function UI-Info    { param($msg) Write-Host "  $S_DOT $msg" -ForegroundColor Gray }
function UI-Success { param($msg) Write-Host "  $S_CHECK $msg" -ForegroundColor Green }
function UI-Warn    { param($msg) Write-Host "  $S_WARN $msg" -ForegroundColor Yellow }
function UI-Error   { param($msg) Write-Host "  $S_CROSS $msg" -ForegroundColor Red }
