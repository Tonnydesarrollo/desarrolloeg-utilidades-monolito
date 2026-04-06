@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "COMMAND=%~1"

if /I "%COMMAND%"=="list" (
  echo {}
  exit /b 0
)

if /I "%COMMAND%"=="get" (
  set "SERVER="
  set /p SERVER=
  echo {"ServerURL":"!SERVER!","Username":"","Secret":""}
  exit /b 0
)

if /I "%COMMAND%"=="store" exit /b 0
if /I "%COMMAND%"=="erase" exit /b 0

exit /b 0
