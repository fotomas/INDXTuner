@echo off
setlocal

:: Builds IndxTuner-<version>.zip against a local DuetWebControl 3.7.0 checkout.
:: Set DWC_DIR to where you cloned DuetWebControl (see README.md).
if "%DWC_DIR%"=="" set DWC_DIR=%USERPROFILE%\Documents\Duet3D\DuetWebControl-3.7-dev\DuetWebControl-3.7-dev
set PLUGIN_ID=IndxTuner

set PLUGIN_REPO=%~dp0
if "%PLUGIN_REPO:~-1%"=="\" set PLUGIN_REPO=%PLUGIN_REPO:~0,-1%

if not exist "%DWC_DIR%\scripts\build-plugin-pkg.js" (
    echo DuetWebControl not found in %DWC_DIR%
    echo Clone it first, see README.md, or run:  set DWC_DIR=C:\path\to\DuetWebControl
    exit /b 1
)

if not exist "%DWC_DIR%\node_modules" (
    echo Installing DuetWebControl's packages once, this takes a few minutes...
    pushd "%DWC_DIR%"
    call npm install
    if errorlevel 1 ( popd & echo npm install failed. & exit /b 1 )
    popd
)

echo Cleaning old build output...
if exist "%PLUGIN_REPO%\dist" rmdir /s /q "%PLUGIN_REPO%\dist"
if exist "%PLUGIN_REPO%\pkg" rmdir /s /q "%PLUGIN_REPO%\pkg"
del /q "%PLUGIN_REPO%\%PLUGIN_ID%-*.zip" 2>nul

echo Building against %DWC_DIR% ...
pushd "%DWC_DIR%"
call npm run build-plugin-pkg -- "%PLUGIN_REPO%"
set RESULT=%errorlevel%
popd
if not "%RESULT%"=="0" (
    echo Build failed.
    exit /b 1
)

for /f "delims=" %%f in ('dir /b /o-d "%PLUGIN_REPO%\%PLUGIN_ID%-*.zip" 2^>nul ^| findstr /v srcmap') do (
    echo.
    echo Done: %PLUGIN_REPO%\%%f
    echo Install it in DWC: Settings - Plugins - Install plugin.
    goto :eof
)
echo No ZIP was produced.
exit /b 1
