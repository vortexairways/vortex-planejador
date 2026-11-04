@echo off
chcp 65001 >nul
title Sincronizar Vortex
cd /d "%~dp0"
node coletor\coletor-local.mjs
echo.
pause
