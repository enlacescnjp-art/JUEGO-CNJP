@echo off
cd /d "%~dp0"
echo ====================================
echo  LAN FIGHTER - Servidor
echo ====================================
echo.
echo Tu IP local:
ipconfig | findstr "IPv4"
echo.
echo Los jugadores deben abrir en su navegador:
echo http://TU_IP:3000
echo.
echo Presiona Ctrl+C para detener el servidor
echo ====================================
echo.
node server.js
pause
