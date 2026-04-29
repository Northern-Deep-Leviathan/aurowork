@echo off
setlocal
set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
call "%VSDEVCMD%" -arch=x64 -host_arch=x64
call corepack pnpm --filter @aurowork/desktop dev:windows
