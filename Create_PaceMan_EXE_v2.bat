@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo Building PaceMan App with PyInstaller (Python 3.12)
echo ==========================================
echo.

REM Define Python 3.12 path
set "PYTHON_312=c:\users\volko\appdata\local\programs\python\python312"

REM Define paths
set "PYINSTALLER=%PYTHON_312%\Scripts\pyinstaller.exe"
set "WORKDIR=%~dp0"

REM Check Python 3.12 exists
if not exist "%PYTHON_312%\python.exe" (
    echo [ERROR] Python 3.12 not found at: %PYTHON_312%
    pause
    exit /b 1
)

cd /d "%WORKDIR%"

echo [OK] Found Python 3.12 at: %PYTHON_312%
%PYTHON_312%\python.exe --version

REM Install dependencies using Python 3.12's pip
echo Installing dependencies...
"%PYTHON_312%\python.exe" -m pip install pyinstaller customtkinter pillow requests -q 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b 1
)

REM Verify PyInstaller is at the correct path
if not exist "%PYINSTALLER%" (
    echo [ERROR] PyInstaller not found at: %PYINSTALLER%
    pause
    exit /b 1
)

echo [OK] PyInstaller verified at: %PYINSTALLER%

REM Check main.py exists
if not exist "main.py" (
    echo [ERROR] main.py not found!
    pause
    exit /b 1
)

REM Ensure build icon is generated from assets\icon.png
if not exist "assets\icon.png" (
    echo [ERROR] assets\icon.png not found!
    pause
    exit /b 1
)

echo Preparing app icon from assets\icon.png...
"%PYTHON_312%\python.exe" -c "from PIL import Image; img=Image.open(r'assets\\icon.png').convert('RGBA'); img.save(r'assets\\icon.ico', format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to generate assets\icon.ico from assets\icon.png
    pause
    exit /b 1
)

if not exist "assets\icon.ico" (
    echo [ERROR] assets\icon.ico was not created!
    pause
    exit /b 1
)

REM Clean previous builds
echo Cleaning previous build...
if exist "%WORKDIR%\build" rd /s /q "%WORKDIR%\build" 2>nul
if exist "%WORKDIR%\dist" rd /s /q "%WORKDIR%\dist" 2>nul
if exist "%WORKDIR%\.spec" del "%WORKDIR%\.spec" 2>nul

REM Build EXE with Python 3.12 and output to dist folder
echo Building EXE... (output will be in dist/ folder)
"%PYINSTALLER%" --noconfirm ^
    --onefile ^
    --windowed ^
    --name "PaceMan_App" ^
    --icon "assets\icon.ico" ^
    --add-data "assets;assets" ^
    --hidden-import customtkinter ^
    --hidden-import requests ^
    --hidden-import pillow ^
    --clean ^
    main.py

if %errorlevel% neq 0 (
    echo [ERROR] Build failed! Check console output above.
    pause
    exit /b 1
)

echo ========================================
echo Build Complete!
echo ========================================
echo EXE location: dist\PaceMan_App.exe
echo ========================================

REM Copy EXE to Desktop
if exist "dist\PaceMan_App.exe" (
    copy "dist\PaceMan_App.exe" "%USERPROFILE%\Desktop\PaceMan_App.exe" 2>nul
    if %errorlevel% equ 0 (
        echo [OK] Copied to Desktop: PaceMan_App.exe
    ) else (
        echo [WARNING] Could not copy EXE to Desktop.
    )
) else (
    echo [ERROR] dist\PaceMan_App.exe was not created!
)

pause