@echo off
rem Removes everything legacies installed. Project memories are kept unless you choose otherwise.
where node >nul 2>nul
if errorlevel 1 (
  echo legacies: kaldirma programi Node.js ister; node bulunamadi.
  exit /b 1
)
node "%~dp0scripts\setup.mjs" uninstall %*
