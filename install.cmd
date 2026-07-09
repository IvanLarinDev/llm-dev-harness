@echo off
rem install.cmd - one-click wrapper for Windows. Installs the harness in this directory.
rem Double-click installs into the directory containing this file; arguments are forwarded.
setlocal
node "%~dp0install.js" %*
echo.
pause
