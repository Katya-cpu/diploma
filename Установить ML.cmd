@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Создаю виртуальное окружение и скачиваю библиотеки (около 300 МБ)...
python -m venv .venv
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
echo Готово. Теперь запустите "Открыть лабораторию.cmd".
pause
