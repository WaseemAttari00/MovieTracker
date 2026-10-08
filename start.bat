@echo off
rem Double-click to start MovieTracker. The first run sets everything up.
setlocal
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python 3.10 or newer is required: https://www.python.org/downloads/
  echo When installing, tick "Add python.exe to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Setting up MovieTracker for the first time...
  %PY% -m venv .venv
  if errorlevel 1 goto :failed
)

fc /b requirements.txt ".venv\installed-requirements.txt" >nul 2>nul
if errorlevel 1 (
  echo Installing dependencies...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
  if errorlevel 1 goto :failed
  copy /y requirements.txt ".venv\installed-requirements.txt" >nul
)

".venv\Scripts\python.exe" run.py %*
if errorlevel 1 pause
exit /b

:failed
echo.
echo Setup failed - see the messages above.
pause
exit /b 1
