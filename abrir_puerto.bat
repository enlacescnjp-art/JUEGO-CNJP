@echo off
echo ====================================
echo  LAN FIGHTER - Abrir puerto 3000
echo ====================================
echo.
echo Ejecutando como administrador...
netsh advfirewall firewall add rule name="LAN Fighter 3000" dir=in action=allow protocol=TCP localport=3000
echo.
echo Puerto 3000 abierto en el firewall
echo.
echo Tu IP local es:
ipconfig | findstr "IPv4"
echo.
pause
