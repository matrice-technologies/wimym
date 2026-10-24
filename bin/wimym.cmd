@echo off
rem wimym on Windows: ask your own record questions (engine\wimym\cli.py). install.cmd --link puts it on your PATH.
rem It reads WIMYM_DATA and WIMYM_CACHE when set; otherwise it uses the folders that exist.
setlocal
set "PYTHONPATH=%~dp0..\engine;%PYTHONPATH%"
set "PYTHONUTF8=1"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m wimym.cli %*
  exit /b
)
python -m wimym.cli %*
