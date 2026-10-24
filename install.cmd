@echo off
rem Wimym in one command on Windows: install.py does the work (install.cmd --help). This finds Python 3 for it.
rem Python 3.9 or later: winget install Python.Python.3.12
setlocal
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0install.py" %*
  exit /b
)
where python >nul 2>nul
if not errorlevel 1 (
  python "%~dp0install.py" %*
  exit /b
)
echo Stopped: Wimym needs Python 3.9 or later. Install it with: winget install Python.Python.3.12 1>&2
exit /b 1
