# =======================================================
# Project Golem v9.0 (Titan Chronos)
# Windows Modular Setup Script (PowerShell)
# =======================================================
$ErrorActionPreference = "Stop"

# --- Encoding & Console Init ---------------------------
# Enforce UTF-8 for Output and ensure character set is 65001
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[System.Console]::InputEncoding = [System.Text.Encoding]::UTF8

Set-Location $PSScriptRoot

# --- Path Constants -------------------------------------
$SCRIPT_DIR = $PSScriptRoot
$LIB_DIR = Join-Path $SCRIPT_DIR "scripts\lib\win"
$DOT_ENV_PATH = Join-Path $SCRIPT_DIR ".env"
$LOG_DIR = Join-Path $SCRIPT_DIR "logs"
$LOG_FILE = Join-Path $LOG_DIR "setup.log"
$PACKAGE_JSON = Join-Path $SCRIPT_DIR "package.json"

# --- Versioning -----------------------------------------
$GOLEM_VERSION = "N/A"
if (Test-Path $PACKAGE_JSON) {
    try {
        $pj = Get-Content $PACKAGE_JSON -Raw | ConvertFrom-Json
        $GOLEM_VERSION = $pj.version
    } catch {
        $GOLEM_VERSION = "Unknown"
    }
}

# --- Load Modules ---------------------------------------
. (Join-Path $LIB_DIR "colors.ps1")
. (Join-Path $LIB_DIR "ui_components.ps1")
. (Join-Path $LIB_DIR "utils.ps1")
. (Join-Path $LIB_DIR "system_check.ps1")
. (Join-Path $LIB_DIR "menu_system.ps1")

# --- Entry Point -----------------------------------------
Check-Status

if ($args.Count -gt 0) {
    if ($args -contains "--start") { Launch-System; exit 0 }
    if ($args -contains "--install") { Run-Full-Install; exit 0 }
    if ($args -contains "--stop") { Stop-System; exit 0 }
    if ($args -contains "--init") { 
        Write-Host "Initializing (removing node_modules)..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
        Run-Full-Install 
        exit 0
    }
    if ($args -contains "--doctor") { Run-Health-Check; exit 0 }
    if ($args -contains "--config") { Run-Config-Wizard; exit 0 }
    if ($args -contains "--status") { Show-Status; exit 0 }
    if ($args -contains "--version") { Write-Host "Project Golem v$GOLEM_VERSION"; exit 0 }
    if ($args -contains "--help" -or $args -contains "-h") { 
        Write-Host "`nProject Golem v$GOLEM_VERSION Setup Script (Windows)" -ForegroundColor Cyan
        Write-Host "Usage: .\setup.ps1 [OPTIONS]"
        Write-Host "`nOPTIONS:"
        Write-Host "  (none)        Launch interactive main menu"
        Write-Host "  --start       Directly launch system (skip menu)"
        Write-Host "  --install     Perform full installation"
        Write-Host "  --config      Launch configuration wizard"
        Write-Host "  --doctor      Run deep system diagnostics"
        Write-Host "  --status      Show system status report"
        Write-Host "  --stop        Stop all running Golem processes"
        Write-Host "  --init        Factory reset (DANGER)"
        Write-Host "  --version     Show version info"
        Write-Host "  --help, -h    Show this help"
        exit 0 
    }
    
    Write-Warning "Unknown argument: $($args[0])"
    exit 1
}

# First run detection
if (-not (Test-Path $DOT_ENV_PATH) -and -not (Test-Path "node_modules")) {
    Show-Header
    Write-Host "`n  👋 Welcome to Project Golem Deployment Assistant" -ForegroundColor Cyan
    Write-Host "  This is your first run. We will guide you through the installation." -ForegroundColor Gray
    if (Confirm-Action "Start automatic installation?") {
        Run-Full-Install
        Launch-System
    }
}

Show-Menu
