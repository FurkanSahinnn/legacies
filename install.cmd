@echo off
rem legacies installer for Windows. It only needs Node 18+; the installer checks everything else.
where node >nul 2>nul
if errorlevel 1 (
  echo legacies: Node.js 18+ gerekli ama bulunamadi.
  echo   winget install OpenJS.NodeJS.LTS
  exit /b 1
)
node "%~dp0scripts\setup.mjs" install %*
