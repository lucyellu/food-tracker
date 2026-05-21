@echo off
setlocal

set PORT=3000
set DIR=%~dp0

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo Server already running on port %PORT%
) else (
    echo Starting Next.js dev server on port %PORT%...
    start /min "" cmd /c "cd /d %DIR% && npm run dev"
    timeout /t 6 /nobreak >nul
)

set CHROME=
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%P set CHROME=%%P
)

if defined CHROME (
    start "" %CHROME% --app="http://localhost:%PORT%/"
) else (
    start "" "http://localhost:%PORT%/"
)

endlocal
