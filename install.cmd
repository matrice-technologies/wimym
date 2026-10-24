@echo off
rem Wimym in one command on Windows: install.py does the work (install.cmd --help). This finds Python 3 for it.
rem Python 3.9 or later: winget install Python.Python.3.12
setlocal
rem goto, not ( ) blocks: inside a block exit /b would lose the installer's exit code
where py >nul 2>nul
if errorlevel 1 goto python
py -3 "%~dp0install.py" %*
exit /b %errorlevel%
:python
where python >nul 2>nul
if errorlevel 1 goto none
python "%~dp0install.py" %*
exit /b %errorlevel%
:none
echo Stopped: Wimym needs Python 3.9 or later. Install it with: winget install Python.Python.3.12 1>&2
exit /b 1
