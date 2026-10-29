@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Установка создаст .venv и загрузит зависимости из интернета. PyTorch может занять много места.
pause
python -m venv .venv
if errorlevel 1 goto error
".venv\Scripts\python.exe" -m pip install -r research\requirements.txt
if errorlevel 1 goto error
echo Зависимости установлены. Запустите лабораторию заново.
pause
exit /b 0
:error
echo Установка завершилась ошибкой. Проверьте наличие Python и доступ в интернет.
pause
exit /b 1
