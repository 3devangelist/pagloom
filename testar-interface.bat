@echo off
rem Pagloom - testar a interface no browser, sem compilar (precisa do Node.js).
cd /d "%~dp0"
start "" http://127.0.0.1:8765/
node dev-server.js 8765
pause
