@echo off
setlocal

set PORT=3000
set DIR=%~dp0
set APP_URL=http://localhost:%PORT%/dashboard
set LOCAL_DB=%DIR%tmp\food-tracker-local.db

if not exist "%LOCAL_DB%" (
    echo Local Food Tracker database not found:
    echo %LOCAL_DB%
    echo Restore an export into tmp\food-tracker-local.db before launching.
    pause
    exit /b 1
)

rem Force the desktop app to use the restored local libSQL database.
set TURSO_DATABASE_URL=file:./tmp/food-tracker-local.db
set TURSO_AUTH_TOKEN=
set LIBSQL_URL=
set LIBSQL_AUTH_TOKEN=
set DATABASE_URL=

netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo Server already running on port %PORT%
) else (
    echo Starting Next.js dev server on port %PORT%...
    start /min "Food Tracker - next-server" cmd /c "cd /d %DIR% && npm run dev -- -H localhost -p %PORT%"
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
    start "" %CHROME% --app="%APP_URL%"
) else (
    start "" "%APP_URL%"
)

endlocal
