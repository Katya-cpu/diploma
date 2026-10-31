@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" server.py
) else (
  echo Библиотеки ML не установлены: разделы 1 и 2 работают, для раздела 3 запустите "Установить ML.cmd".
  python server.py
)
pause
