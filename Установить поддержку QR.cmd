@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Установка локального декодера QR создаст .venv и скачает Pillow и zxing-cpp.
echo Изображения при распознавании не отправляются в интернет.
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 goto error
".venv\Scripts\python.exe" -m pip install "Pillow>=10,<13" "zxing-cpp>=2.2,<4"
if errorlevel 1 goto error
echo Готово. Закройте и заново запустите лабораторию.
pause
exit /b 0
:error
echo Ошибка установки. Проверьте Python и доступ в интернет.
pause
exit /b 1
