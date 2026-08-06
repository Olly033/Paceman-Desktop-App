@echo off
cd /d "%~dp0"

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py main.py
    exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    python main.py
    exit /b %ERRORLEVEL%
)

echo Python was not found on PATH. Please install Python and reopen this launcher.
pause
exit /b 1
