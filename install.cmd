@echo off
rem install.cmd — обёртка одного клика (Windows). Ставит харнесс в текущий каталог.
rem Двойной клик = установка в папку, где лежит этот файл; аргументы прокидываются.
setlocal
node "%~dp0install.js" %*
echo.
pause
