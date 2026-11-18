@echo off
rem Start the family-graph backend (FastAPI) and frontend (Vite) together.
rem Double-click this file, or run it from a terminal. Extra arguments are
rem passed through, e.g.  dev.cmd -BackendPort 8001 -FrontendPort 5191
setlocal

set "DEV_PS1=%~dp0scripts\dev.ps1"
if not exist "%DEV_PS1%" (
    echo [dev] Cannot find "%DEV_PS1%".
    exit /b 1
)

where pwsh >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%DEV_PS1%" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%DEV_PS1%" %*
)

exit /b %ERRORLEVEL%
