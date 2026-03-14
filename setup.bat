@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: Project Golem v9.0 - Windows Bridge
:: 此腳本會嘗試尋找 Git Bash 並執行 setup.sh

set "SCRIPT_DIR=%~dp0"
cd /d "!SCRIPT_DIR!"

:: 嘗試多個可能的 Git Bash 路徑
set "GIT_BASH_PATHS="C:\Program Files\Git\bin\sh.exe" "C:\Program Files (x86)\Git\bin\sh.exe" "%USERPROFILE%\AppData\Local\Programs\Git\bin\sh.exe""

set "SH_PATH="
for %%P in (%GIT_BASH_PATHS%) do (
    if exist %%P (
        set "SH_PATH=%%P"
        goto :FOUND_SH
    )
)

:: 檢查是否在 PATH 中
where sh.exe >nul 2>&1
if !errorlevel! equ 0 (
    set "SH_PATH=sh.exe"
    goto :FOUND_SH
)

echo [ERROR] 找不到 Git Bash (sh.exe)！
echo Project Golem 需要 Git Bash 才能正確執行安裝。
echo 請安裝 Git for Windows: https://git-scm.com/download/win
echo 安裝後請使用「Git Bash」視窗執行 ./setup.sh --install
pause
exit /b 1

:FOUND_SH
echo [INFO] 正在透過 Git Bash 啟動部署程序...
!SH_PATH! "%SCRIPT_DIR%setup.sh" %*
exit /b %errorlevel%
