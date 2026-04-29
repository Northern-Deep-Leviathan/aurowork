@echo off
setlocal
rem Detect host architecture (x64 or arm64); allow override via HOST_ARCH env var.
set "HOST=%HOST_ARCH%"
if not defined HOST set "HOST=%PROCESSOR_ARCHITECTURE%"
if /I "%HOST%"=="AMD64" set "HOST=x64"
if /I "%HOST%"=="ARM64" set "HOST=arm64"
if not defined HOST set "HOST=x64"

set "VSDEVCMD=%VSDEVCMD_PATH%"
if not defined VSDEVCMD if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if defined VSDEVCMD call "%VSDEVCMD%" -arch=x64 -host_arch=%HOST% >nul
call corepack pnpm --filter @aurowork/desktop dev:windows
