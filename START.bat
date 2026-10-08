@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Lernyqo Starter

color 0F

echo.
echo ==================================================
echo                 LERNYQO STARTER
echo          One upload. Complete revision.
echo ==================================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON=py"
    goto :python_ok
)
where python >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON=python"
    goto :python_ok
)

echo [ERROR] Python was not found.
echo.
echo Please install Python 3.11 or newer from:
echo https://www.python.org/downloads/windows/
echo.
echo IMPORTANT: during Python installation, tick:
echo "Add Python to PATH"
echo.
pause
goto :eof

:python_ok
if not exist ".venv\Scripts\python.exe" (
    echo [1/4] Creating Lernyqo's private Python environment...
    %PYTHON% -m venv .venv
    if errorlevel 1 goto :setup_error
)

call ".venv\Scripts\activate.bat"
if errorlevel 1 goto :setup_error

echo [2/4] Checking Python packages...
python -m pip install --upgrade pip --disable-pip-version-check
if errorlevel 1 goto :setup_error
python -m pip install -r requirements.txt --disable-pip-version-check
if errorlevel 1 goto :setup_error

if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    echo [3/4] Created .env with Demo Mode enabled.
) else (
    echo [3/4] Keeping your existing .env settings.
)

echo [4/4] Starting Lernyqo...
echo.
echo The website will open at http://127.0.0.1:8000
 echo Keep this black window open while using Lernyqo.
echo.
start "Lernyqo" http://127.0.0.1:8000
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

echo.
echo Lernyqo has stopped.
pause
goto :eof

:setup_error
echo.
echo ==================================================
echo SETUP FAILED
 echo Look at the error above. Do not close this window.
echo Send a screenshot of this window to ChatGPT.
echo ==================================================
echo.
pause
