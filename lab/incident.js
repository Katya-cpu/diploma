(() => {
  'use strict';
  const actions={
    card:['Позвоните в банк по официальному номеру и сообщите, какие данные были введены.','Обсудите блокировку или перевыпуск карты и проверьте операции.','Не сообщайте коды подтверждения и PIN никому.'],
    transfer:['Свяжитесь с банком как можно быстрее через официальное приложение или номер на карте.','Сообщите дату, сумму и данные операции и уточните возможность оспорить перевод.','Сохраните переписку и документы без PIN, CVV, паролей и одноразовых кодов.'],
    account:['Смените пароль в официальном приложении или на сайте, который открыли самостоятельно.','Обратитесь к поставщику сервиса и проверьте активные сеансы.','Если данные карты могли быть раскрыты, отдельно свяжитесь с банком.']
  };
  document.getElementById('incident-type').onchange=event=>{
    const list=document.getElementById('incident-actions');list.replaceChildren(...actions[event.target.value].map(s=>{const li=document.createElement('li');li.textContent=s;return li}));
  };
  document.getElementById('incident-type').dispatchEvent(new Event('change'));
})();
