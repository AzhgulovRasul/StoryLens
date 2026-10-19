@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\get-tools.ps1"
if errorlevel 1 (
  echo Preparation failed. Check the connection and read README.md.
  pause
  exit /b 1
)
echo Ready. Import and export now work offline.
pause
