@echo off
echo =========================================
echo Building PaceMan App with PyInstaller
echo =========================================
echo.

REM Use Python 3.12 from the specified location
set PYTHON_312_PATH="C:\Users\volko\AppData\Local\Programs\Python\Python312"

REM Check if Python 3.12 exists
if exist "%PYTHON_312_PATH%\python.exe" (
    echo ✓ Found Python 3.12 at: %PYTHON_312_PATH%
    
    REM Change to the directory where this script is located
    cd /d "%~dp0"
    
    REM Verify Python version
    echo Checking Python version...
    %PYTHON_312_PATH%\python.exe --version
    
    REM Run PyInstaller build with Python 3.12
    echo.
    echo Starting EXE build with PyInstaller (Python 3.12)...
    echo.
    
    %PYTHON_312_PATH%\python.exe -m pyinstaller --onefile --windowed --name "PaceMan_App" --add-data "assets;assets" main.py
    
    if %errorlevel% equ 0 (
        echo.
        echo =========================================
        echo Build successful!
        echo EXE created: dist\PaceMan_App.exe
        echo =========================================
    ) else (
        echo.
        echo =========================================
        echo Build failed! Check the output above for errors.
        echo Common fixes:
        echo 1. Make sure Python 3.12 is installed at the path above
        echo 2. Run this script as Administrator if needed
        echo =========================================
    )
    
) else (
    echo ✗ ERROR: Python 3.12 not found!
    echo Expected at: %PYTHON_312_PATH%\python.exe
    echo.
    echo Please install Python 3.12 from:
    echo - https://www.python.org/downloads/
    echo - Or Microsoft Store (search for "Python")
    echo.
    pause
    exit /b 1
)

pause