@echo off
rem Lets cmd and PowerShell run `legacies ...` while the plugin is enabled.
node "%~dp0..\scripts\legacies.mjs" %*
