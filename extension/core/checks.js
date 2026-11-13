/*
 * Анализатор страницы — «мозг» расширения. Этот же файл подключает лаборатория,
 * поэтому администратор видит ровно те решения, которые принимает расширение.
 *
 * inspect(document, sensors) → отчёт:
 *   verdict   — общий итог (danger / warning / ok / none);
 *   findings  — найденные признаки: какая проверка, насколько серьёзно, почему;
 *   recipient — кому уйдут деньги (реквизиты из текста и QR);
 *   limits    — что проверить не удалось (отсутствие данных ≠ безопасность).
 */
(function (root) {
  'use strict';
  const R = root.PGRecipient, D = root.PGDom;

  // Известные платёжные провайдеры: форма или окно оплаты у них — нормальная практика.
  const PSP = ['yookassa.ru', 'yoomoney.ru', 'cloudpayments.ru', 'tbank.ru', 'tinkoff.ru', 'sberbank.ru', 'nspk.ru',
    'robokassa.ru', 'payture.com', 'uniteller.ru', 'payler.com', 'paymaster.ru', 'best2pay.net', 'alfabank.ru', 'vtb.ru',
    'gazprombank.ru', 'stripe.com', 'paypal.com', 'pay-psp.test'];
  const isPsp = (host) => PSP.includes(D.siteOf(host));

  const PAY_WORDS = /оплат|перевед|перевод (?:денег|средств|на)|к оплате|купить|(?:^|[^a-z])(?:pay|checkout)(?![a-z])/i;
  // Обещание человеку получить деньги («получите выплату», «для получения средств», «вывести деньги»).
  // Формы третьего лица («магазин получает оплату», «мы получим перевод») — это рассказ о работе сайта, не приманка.
  const RECEIVE_WORDS = /(получи(?:ть|те)|получени[еяю]|зачисли(?:ть|те|м)|зачислени[еяю]|принять|вывести|вывод)\s+(?:\S+\s+){0,3}(деньг|оплат|выплат|средств|перевод|компенсац)/i;
  // Действие, которое ведёт к деньгам или необратимому подтверждению. По нему решаем,
  // относится ли обман интерфейса к платежу, — чтобы не предупреждать про каждую кнопку на сайте.
  const PAY_ACTION = /оплат|перевод|перевед|подтверд|подпис|списан|купить|charge|checkout|subscri|transfer|confirm|withdraw|(?:^|[^a-z])pay(?![a-z])/i;

  function amountsIn(text) {
    const out = [];
    for (const m of String(text).matchAll(/(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?(?:₽|руб)/gi)) {
      out.push(Number(m[1].replace(/\D/g, '') + '.' + (m[2] || '0')));
    }
    return [...new Set(out)];
  }
  const rub = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

  // Найти фразу так, чтобы она не стояла под отрицанием. «Никому не сообщайте код» или
  // «банк никогда не просит переводить на безопасный счёт» — это предупреждение, а не просьба.
  // Правило простое: в том же предложении перед найденной фразой нет слов «не», «никогда», «никому», «нельзя».
  const NEGATION = /(?:^|[\s,(«"])(?:не|ни|никогда|никому|нельзя|запрещ[а-яё]*)\s/i;
  function findAffirmed(text, re) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of String(text).matchAll(g)) {
      const start = Math.max(text.lastIndexOf('.', m.index), text.lastIndexOf('!', m.index), text.lastIndexOf('?', m.index), text.lastIndexOf('\n', m.index)) + 1;
      if (!NEGATION.test(' ' + text.slice(start, m.index))) return m;
    }
    return null;
  }

  // Есть ли номер карты в исходящем запросе — открытым текстом, в URL-кодировке или в base64.
  // Сравнение идёт только в памяти; номер карты никуда не сохраняется и не отправляется.
  function cardInPayload(payload, digits) {
    if (!digits || digits.length < 12 || !payload) return null;
    const has = (t) => String(t).replace(/[\s\-]/g, '').includes(digits);
    if (has(payload)) return 'открытым текстом';
    const layers = [payload];
    try { layers.push(decodeURIComponent(payload)); } catch (e) { /* не URL-кодировка */ }
    if (has(layers[layers.length - 1])) return 'в URL-кодировке';
    for (let depth = 0; depth < 2; depth++) {
      for (const t of layers.slice()) {
        for (const m of String(t).matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)) {
          let dec = '';
          try { dec = atob(m[0].replace(/-/g, '+').replace(/_/g, '/')); } catch (e) { continue; }
          if (has(dec)) return 'в закодированном виде (base64)';
          layers.push(dec);
        }
      }
    }
    return null;
  }

  // Кем представляется страница — смотрим только туда, где сайт называет себя: заголовок окна,
  // заголовки h1/h2, шапку, логотип, подвал. Раньше искали по всему тексту, и слово «заказ»
  // в любой новости делало страницу «магазином».
  function roleText(doc) {
    const parts = [doc.title];
    for (const el of doc.querySelectorAll('h1, h2, header, [role=banner], footer, [class*=logo], [class*=brand], .site, .bar')) {
      parts.push(el.innerText || el.textContent || '');
    }
    return parts.join('\n').slice(0, 5000);
  }

  function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) : 0;
  }
  // Кто на самом деле получит нажатие в середине видимой кнопки: спрашиваем у браузера (elementFromPoint).
  // Перекрытия по координатам мало — невидимый слой может лежать ПОД кнопкой (например, рекламное окно под текстом).
  function receivesClick(doc, win, visibleEl, inv) {
    const a = rectOf(visibleEl), b = rectOf(inv);
    const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w), y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
    let x = (x0 + x1) / 2, y = (y0 + y1) / 2;
    const sx = win.scrollX, sy = win.scrollY;
    const outside = x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight;
    if (outside) { win.scrollTo(sx + x - win.innerWidth / 2, sy + y - win.innerHeight / 2); x -= win.scrollX - sx; y -= win.scrollY - sy; }
    const hit = doc.elementsFromPoint(x, y).find((el) => !el.closest('[data-pg-panel]')); // панель самого помощника пропускаем
    if (outside) win.scrollTo(sx, sy); // вернуть страницу туда, где её оставил пользователь
    return !!hit && (hit === inv || inv.contains(hit));
  }

  // ---------- Сбор скриптов страницы (встроенные + файлы того же сайта или любого в расширении) ----------
  async function collectScripts(doc, allowFetch, loc) {
    loc = loc || doc.location;
    const list = [];
    for (const s of doc.querySelectorAll('script')) {
      const src = s.getAttribute('src');
      if (!src) { list.push({ name: 'встроенный скрипт', host: loc.hostname, code: s.textContent.slice(0, 200000) }); continue; }
      let url;
      try { url = new URL(src, loc.href); } catch (e) { continue; }  // битый адрес (бывает на настоящих сайтах) — пропускаем
      const item = { name: url.pathname.split('/').pop() || url.hostname, host: url.hostname, src: url.href, code: '' };
      if (allowFetch) {
        try { item.code = (await (await fetch(url.href)).text()).slice(0, 300000); } catch (e) { item.unreadable = true; }
      }
      list.push(item);
    }
    return list;
  }

  // Раскрываем спрятанные строки: base64 из atob('...') и коды символов из String.fromCharCode(...).
  // Так скиммеры прячут адрес, на который отправляют данные.
  function revealHidden(code) {
    let extra = '';
    for (const m of code.matchAll(/atob\(\s*['"]([A-Za-z0-9+/=]{8,})['"]\s*\)/g)) {
      try { extra += '\n' + atob(m[1]); } catch (e) { /* не base64 */ }
    }
    for (const m of code.matchAll(/String\.fromCharCode\(\s*((?:\d+\s*,\s*){4,}\d+)\s*\)/g)) {
      extra += '\n' + String.fromCharCode(...m[1].split(',').map(Number));
    }
    return extra;
  }

  // =====================================================================
  //  Проверки. Каждая получает общий контекст ctx и возвращает список находок.
  // =====================================================================
  const CHECKS = {};

  // 1. Форма ввода карты: где она и куда отправит данные
  CHECKS['card-form'] = (ctx) => {
    const cards = ctx.fields.filter((f) => f.kind === 'cardNumber');
    if (!cards.length) return [];
    const out = [{ severity: 'info', title: 'На странице есть форма для данных карты',
      details: ['Сайт: ' + ctx.host + '. Вводите данные карты только на сайте, адрес которого вы проверили сами.'] }];
    if (ctx.protocol === 'http:' && !ctx.isLocal) {
      out.push({ severity: 'danger', title: 'Страница с вводом карты открыта без HTTPS', details: ['Данные могут быть перехвачены по пути к сайту.'] });
    }
    // Лишние данные: при оплате картой хватает номера, срока, CVV и имени. Номер социального страхования,
    // девичью фамилию матери, PIN карты, пароль от почты или онлайн-банка магазин не спрашивает никогда —
    // их собирают фишинговые наборы «подтвердите данные», чтобы потом пройти проверку банка от имени жертвы.
    const EXTRA = { ssn: 'номер социального страхования (SSN/СНИЛС)', maiden: 'девичья фамилия матери', pin: 'PIN-код карты',
      mailPassword: 'пароль от почты', bankPassword: 'пароль от онлайн-банка, кодовое слово или PIN' };
    const extra = Object.keys(EXTRA).filter((k) => ctx.has(k)).map((k) => EXTRA[k]);
    if (extra.length) {
      out.push({ severity: 'danger', title: 'Вместе с картой просят данные, которые для оплаты не нужны',
        details: ['Кроме данных карты форма просит: ' + extra.join(', ') + '.',
          'Для оплаты достаточно номера карты, срока действия, CVV и имени. Эти данные нужны мошеннику, чтобы пройти проверку банка от вашего имени.'] });
    }
    // Скрипт платёжного провайдера на странице: такие виджеты сами шифруют номер карты и отдают магазину только токен.
    const pspScript = ctx.scripts.some((sc) => sc.src && isPsp(sc.host));
    // Адрес бота Telegram в коде страницы (в том числе спрятанный в atob или String.fromCharCode): так отправляют карту
    // наборы, где форму обрабатывает скрипт, а не атрибут action.
    const tgInCode = ctx.scripts.find((sc) => /api\.telegram\.org\/bot/i.test(sc.code + revealHidden(sc.code)));
    const ownServer = new Set();
    let telegram = false;
    for (const f of cards) {
      const form = f.el.form;
      if (!form) continue; // номер карты отправит скрипт, а не форма — это видит проверка «Скиммер»
      const action = form.getAttribute('action') || ''; // пустой action — отправка на тот же адрес
      let u;
      try { u = new URL(action, ctx.url); } catch (e) { continue; }
      // Номер карты уйдёт на сервер самого сайта: у поля есть name (значит, оно отправится вместе с формой),
      // адрес отправки — тот же сайт, и на странице нет скрипта платёжного провайдера.
      // Честный магазин номер карты к себе не принимает: поля стоят в окне провайдера или их шифрует его скрипт.
      // Принимать номер карты на свой сервер можно только с полной сертификацией PCI DSS — так делают единицы,
      // а фишинговые наборы — почти всегда: в Phish360 336 из 367 поддельных форм оплаты отправляют карту на свой же сервер.
      if (f.el.getAttribute('name') && D.siteOf(u.hostname) === ctx.site && !pspScript && !tgInCode && (ctx.protocol === 'https:' || ctx.isLocal)) {
        ownServer.add(u.hostname + u.pathname);
      }
      if (/(^|\.)telegram\.org$/i.test(u.hostname) && /\/bot/i.test(u.pathname)) {
        if (telegram) continue;
        telegram = true;
        out.push({ severity: 'danger', title: 'Данные карты уходят в Telegram-бота',
          details: ['Форма отправляется на ' + u.hostname + '/bot… — это программный интерфейс ботов Telegram.',
            'Магазины так не принимают оплату. Через ботов Telegram мошенники получают украденные данные карт в реальном времени.'] });
      } else if (u.protocol === 'http:' && !D.isLocalHost(u.hostname)) {
        out.push({ severity: 'danger', title: 'Данные карты будут отправлены без шифрования', details: ['Адрес отправки формы: ' + u.protocol + '//' + u.hostname] });
      } else if (D.siteOf(u.hostname) !== ctx.site && !isPsp(u.hostname)) {
        out.push({ severity: 'warning', title: 'Данные карты уходят на другой сайт', details: ['Страница: ' + ctx.host + ', а форма отправляется на ' + u.hostname + ' — это не известный платёжный провайдер.'] });
      }
    }
    // Тот же приём без атрибута action: форму отправляет скрипт страницы, и адрес бота Telegram записан в его коде
    // (в том числе спрятан в atob или String.fromCharCode). Так устроено большинство наборов, собранных из одной HTML-страницы.
    const tgScript = telegram ? null : tgInCode;
    if (tgScript) {
      out.push({ severity: 'danger', title: 'Данные карты уходят в Telegram-бота',
        details: ['В коде страницы (' + tgScript.name + ') записан адрес api.telegram.org/bot… — это программный интерфейс ботов Telegram.',
          'Магазины так не принимают оплату. Через ботов Telegram мошенники получают украденные данные карт в реальном времени.'] });
    }
    // Страница выдаёт себя за окно платёжного сервиса. У настоящего Stripe Checkout, ЮKassa, CloudPayments поля карты
    // стоят во фрейме с адреса самого сервиса или страница загружает его скрипт. Если на странице написано «Powered by
    // stripe» / «Оплата через ЮKassa», а поля карты — обычные поля самой страницы и кода сервиса нет, это копия его окна.
    // Так устроен набор «оплата подписки ChatGPT», найденный на взломанных сайтах (urlscan.io, 2026).
    const CLAIMS = [['Stripe', /powered by\s*stripe|unterstützt von\s*stripe|propulsé par\s*stripe|con tecnología de\s*stripe|stripe checkout/i, /(^|\.)stripe\.(com|network)$/],
      ['ЮKassa', /юkassa|юkassa|yookassa|юmoney|yoomoney/i, /(^|\.)(yookassa|yoomoney)\.ru$/],
      ['CloudPayments', /cloudpayments/i, /(^|\.)cloudpayments\.ru$/],
      ['Т-Касса', /т-касс|tinkoff ?kassa|т-банк.{0,20}эквайринг/i, /(^|\.)(tbank|tinkoff)\.ru$/],
      ['PayPal', /powered by\s*paypal|paypal checkout/i, /(^|\.)paypal\.com$/]];
    const providerLoaded = (re) => ctx.scripts.some((sc) => sc.host && re.test(sc.host)) ||
      [...ctx.doc.querySelectorAll('iframe[src]')].some((fr) => re.test(D.hostOf(fr.getAttribute('src'), ctx.url)));
    const ownCard = cards.some((f) => f.el.form && D.siteOf(D.hostOf(f.el.form.getAttribute('action') || '', ctx.url) || ctx.host) === ctx.site);
    const claim = CLAIMS.find(([, said, host]) => said.test(ctx.text) && !host.test(ctx.host) && !providerLoaded(host));
    if (claim && ownCard) {
      out.push({ severity: 'danger', title: 'Страница выдаёт себя за окно оплаты ' + claim[0],
        details: ['На странице написано, что оплату проводит ' + claim[0] + ', но поля карты — обычные поля этой страницы, и форма отправит их на ' + ctx.host + '. Кода ' + claim[0] + ' на странице нет.',
          'Настоящее окно ' + claim[0] + ' открывается на его собственном адресе или во фрейме с этого адреса. Это копия окна оплаты.'] });
      ownServer.clear(); // тот же факт уже назван точнее
    }
    if (ownServer.size) {
      out.push({ severity: 'warning', title: 'Номер карты уйдёт на сервер этого сайта, а не платёжному провайдеру',
        details: ['Форма отправит номер карты на ' + [...ownServer].join(', ') + '. Окна банка или платёжного провайдера на странице нет.',
          'Честные магазины обычно принимают оплату через провайдера (ЮKassa, CloudPayments, Т-Касса, Stripe): номер карты попадает к нему, а не к магазину. ' +
          'Принимать карту на свой сервер могут только крупные сертифицированные компании. Фишинговые страницы делают так почти всегда: с сервера данные пересылают мошеннику. Проверьте адрес сайта.'] });
    }
    return out;
  };

  // 2. «Получить деньги» через ввод данных карты (схема «Мамонт», роль продавца)
  CHECKS['receive-money'] = (ctx) => {
    if (!RECEIVE_WORDS.test(ctx.text)) return [];
    const asked = [];
    if (ctx.has('cvv')) asked.push('CVV/CVC-код');
    if (ctx.has('expiry')) asked.push('срок действия');
    if (ctx.has('balance')) asked.push('баланс карты');
    if (!asked.length) return [];
    return [{ severity: 'danger', title: 'Для получения денег просят секретные данные карты',
      details: ['Страница обещает выплату/получение денег и при этом просит: ' + asked.join(', ') + '.',
        'Чтобы получить перевод, достаточно номера карты или телефона. CVV, срок и баланс нужны только для списания денег с вашей карты.'] }];
  };

  // 3. Коды из SMS, пароли от банка
  CHECKS['secret-codes'] = (ctx) => {
    // Считаются только поля, которые человек видит сейчас. Скрытое окно «Войти по коду из SMS»
    // есть почти на каждом сайте с личным кабинетом — его ещё никто не показал и ничего не просит.
    const shown = (kind) => ctx.fields.some((f) => f.kind === kind && D.isRendered(f.el));
    const asked = [];
    if (shown('smsCode')) asked.push('код из SMS');
    if (shown('bankPassword')) asked.push('пароль/кодовое слово/PIN');
    const textAsk = !!findAffirmed(ctx.text, /(сообщите|назовите|продиктуйте|отправьте|введите)\s+(?:\S+\s+){0,3}(код из (?:смс|sms)|код подтверждения|пароль от)/i);
    if (!asked.length && !textAsk) return [];
    // Сам по себе запрос кода нормален: так выглядят вход в личный кабинет и страница подтверждения банка (3-D Secure).
    // Решает контекст — три уровня:
    //   «опасно»        — код просит не банк (обещают выплату, пишет «курьер» или «служба безопасности»),
    //                     код спрашивают вместе с данными карты (банк делает это на отдельной странице),
    //                     или код нужен, «чтобы отменить операцию» (банк никогда не отменяет операции по коду);
    //   «подозрительно» — код подтверждает платёж (3-D Secure, сумма, номер карты, «транзакция»):
    //                     так выглядит и настоящая страница банка, и её подделка — проверьте адрес;
    //   «к сведению»    — обычный вход по коду, платежа рядом нет.
    const cancelLure = findAffirmed(ctx.text, /(?:отмен|cancel)[а-яёa-z]*\s+(?:\S+\s+){0,3}(?:операц|транзакц|списан|платеж|платёж|перевод|transaction|payment|operation)/i);
    const risky = RECEIVE_WORDS.test(ctx.text) || /служба безопасности|доставк|курьер/.test(ctx.role || '') || ctx.has('cardNumber') || !!cancelLure;
    const payConfirm = /3-?d[\s-]?secure|verified by visa|securecode|mir\s?accept|номер карты|card number|транзакц|transaction|списани|подтвер[а-яё]* (?:оплат|платеж|платёж|перевод)|confirm (?:the |your )?payment/i.test(ctx.text);
    if (!risky && !shown('bankPassword')) {
      if (!asked.length) return []; // просьба ввести код в тексте без опасного контекста — обычная страница входа
      if (payConfirm) {
        return [{ severity: 'warning', title: 'Код из SMS подтверждает платёж — проверьте, что это сайт вашего банка',
          details: ['Страница похожа на подтверждение оплаты (3-D Secure): код из SMS разрешает списать деньги с карты.',
            'Настоящая страница подтверждения открывается на сайте банка или в его окне внутри магазина. Сейчас адрес страницы: ' + ctx.host + '. Если это не ваш банк — не вводите код.'] }];
      }
      return [{ severity: 'info', title: 'Страница просит код из SMS',
        details: ['Вводите код только на странице подтверждения своего банка и никому его не сообщайте.'] }];
    }
    return [{ severity: 'danger',
      title: 'Страница просит секретный код или пароль от банка',
      details: ['Запрашивается: ' + (asked.join(', ') || 'код подтверждения (в тексте)') + '.',
        cancelLure ? 'Код просят, чтобы «отменить операцию». Банк не отменяет операции по коду из SMS: этим кодом мошенник, наоборот, подтвердит списание.'
          : 'Код из SMS подтверждает списание денег. Его вводят только на странице подтверждения вашего банка (3-D Secure) и никогда не сообщают магазину, курьеру или «службе безопасности».'] }];
  };

  // 4. Просьба перевести деньги вручную (APP-мошенничество)
  // Проверка складывает признаки, а не срабатывает на одну фразу:
  //   основа     — просьба перевести деньги именно человеку (на карту, по телефону) или видны реквизиты частного лица;
  //   усилители  — «онлайн-оплата не работает», «пришлите скриншот/чек», скидка 40 % и больше,
  //                страница выдаёт себя за магазин/доставку/организацию.
  // Основа без усилителей → «подозрительно»; основа + хотя бы один усилитель → «опасно».
  // «Оплата через СБП» без реквизитов частного лица — обычная оплата по QR, предупреждения нет.
  CHECKS['manual-transfer'] = (ctx) => {
    const m = findAffirmed(ctx.text, /(переведите|перевести|отправьте|внесите|оплатите|оплата)[^.!?\n]{0,80}?(на (?:номер )?карт[а-яё\w]*|по номеру (?:карты|телефона)|на номер телефона|по телефону|на (?:указанный |этот |следующий )?сч[её]т|через сбп)/i);
    if (!m) return [];
    const items = ctx.recipient.items;
    const phrase = 'Фраза на странице: «' + m[0].trim().slice(0, 120) + '».';
    if (items.length && items.every((i) => ['company', 'entrepreneur', 'treasury'].includes(i.kind))) {
      return [{ severity: 'info', title: 'Оплата по реквизитам организации',
        details: [phrase + ' Деньги уходят на счёт организации — это обычная практика для счетов и квитанций. Сверьте название и ИНН с договором.'] }];
    }
    const toPerson = items.some((i) => i.kind === 'person' || i.kind === 'deposit') || /карт|телефон/i.test(m[2]);
    if (!toPerson) return [];
    const boosters = [];
    if (/онлайн[- ]?оплат[а-яё]*[^.!?\n]{0,40}(не работает|недоступн|отключ|не принима)|оплат[а-яё]* только переводом/i.test(ctx.text)) boosters.push('«онлайн-оплата не работает» — сайт уводит от защищённой оплаты');
    if (/пришлите[^.!?\n]{0,20}(скриншот|чек|фото)/i.test(ctx.text)) boosters.push('просят прислать скриншот перевода — подтверждения оплаты у сайта нет');
    const disc = ctx.text.match(/скидк[а-яё]*[^\d\n]{0,12}(\d{2})\s?%/i);
    if (disc && Number(disc[1]) >= 40) boosters.push('скидка ' + disc[1] + ' % — типичная приманка фейковых магазинов');
    if (ctx.role && ctx.role !== 'служба безопасности банка') boosters.push('страница представляется как «' + ctx.role + '», но деньги просят перевести человеку');
    return [{ severity: boosters.length ? 'danger' : 'warning', title: 'Предлагают перевести деньги человеку, а не оплатить на сайте',
      details: [phrase].concat(boosters.length ? ['Усиливающие признаки: ' + boosters.join('; ') + '.'] : [],
        ['Такой перевод вы подтверждаете сами, поэтому вернуть деньги через банк почти невозможно. Магазины и службы доставки принимают оплату через платёжную форму, а не переводом на карту.']) }];
  };

  // 5. Кому уйдут деньги: согласованность реквизитов с тем, кем представляется страница
  CHECKS['recipient'] = (ctx) => {
    const out = [];
    const r = ctx.recipient;
    // Вход в схему «безопасный счёт»: страница от имени Госуслуг, банка или ведомства пугает взломом
    // и даёт номер «контактного центра». Дальше по телефону «специалист» уводит к переводу денег.
    // Настоящая страница: fnsnalog-ru.online (urlscan, 22.10.2026) — «Вас взломали! Обратитесь в контактный центр Госуслуг 8(800)…».
    // Памятки банков («Что делать, если вас взломали») не считаются: заголовок должен быть утверждением, а не советом.
    const SCARE = /вас взломали|ваш[а-я]* (?:аккаунт|кабинет|профиль|учётн[а-я]* запис[а-я]*) взлом|обнаружены подозрительные действия|зафиксирован[а-я]* попытк[а-я]* (?:взлома|входа|списани)/i;
    const scareHead = [...ctx.doc.querySelectorAll('h1, h2, h3, strong, b, [class*=title], [class*=badge], [class*=alert]')]
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).find((t) => t.length < 120 && SCARE.test(t) && !/что делать|если|как |памятк|\?/i.test(t));
    // Номер часто стоит отдельной строкой под просьбой («позвоните на номер ниже»), а перед просьбой — «если это были не вы»:
    // это не отрицание просьбы, поэтому здесь ищем без findAffirmed — контекст уже подтверждён заголовком.
    const callTo = scareHead && ctx.text.match(/(?:позвоните|обратитесь|свяжитесь|звоните)[\s\S]{0,100}?((?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})/i);
    if (callTo) {
      out.push({ severity: 'danger', title: 'Страница пугает взломом и просит позвонить по номеру',
        details: ['Заголовок: «' + scareHead.slice(0, 90) + '». Номер для звонка: ' + callTo[1].replace(/\s+/g, ' ') + '.',
          'Так начинается схема «безопасный счёт»: по этому номеру ответит «специалист», который убедит перевести деньги или назвать коды. Госуслуги и банки не просят звонить по номеру со страницы — звоните только по номеру с обратной стороны карты или с официального сайта, набранного вручную.'] });
    }
    if (!r.items.length) return out;
    const persons = r.items.filter((i) => i.kind === 'person' || i.kind === 'deposit');
    if (ctx.role && persons.length) {
      out.push({ severity: 'danger', title: 'Страница от имени организации просит перевести деньги частному лицу',
        details: ['Страница представляется как: ' + ctx.role + '.',
          'Но деньги уйдут: ' + persons.map((p) => p.text).join('; ') + '.',
          'Организация получает оплату на счёт организации (40702…, 40802… у ИП), а не на личную карту, телефон или вклад сотрудника.'] });
    }
    // Проверка «Кому уйдут деньги» запускается, только если на странице есть реквизиты (см. выше),
    // поэтому новость о мошенниках или памятка банка («безопасных счетов не существует») тревоги не дают.
    if (findAffirmed(ctx.text, /безопасн[а-яё\w]+ сч[её]т|резервн[а-яё\w]+ сч[её]т|защищ[её]нн[а-яё\w]+ сч[её]т/i)) {
      out.push({ severity: 'danger', title: '«Безопасный счёт» — признак обмана',
        details: ['Банки и Банк России не переводят деньги клиентов на «безопасные» или «резервные» счета. Это самая частая схема телефонного мошенничества.'] });
    }
    for (const bad of r.items.filter((i) => i.invalid)) {
      out.push({ severity: 'warning', title: 'Реквизиты не проходят проверку контрольной суммы', details: [bad.text + ': ' + bad.invalid] });
    }
    if (!out.length) {
      out.push({ severity: 'info', title: 'Получатель платежа', details: r.items.map((i) => i.text).concat(ctx.role ? ['Страница представляется как: ' + ctx.role + '.'] : []) });
    }
    return out;
  };

  // 6. QR-коды: что на самом деле зашито в картинку
  CHECKS['qr-code'] = (ctx) => {
    const out = [];
    const pageSums = ctx.amounts;
    for (const q of ctx.qr.found) {
      const gost = R.parseGostQr(q.raw), sbp = R.parseSbpLink(q.raw);
      if (gost) {
        const t = R.accountType(gost.account || '');
        out.push({ severity: 'info', title: 'Платёжный QR-код (ГОСТ Р 56042)',
          details: ['Получатель в коде: ' + (gost.name || 'не указан') + (gost.inn ? ', ИНН ' + gost.inn : '') + '.',
            'Счёт: ' + (gost.account ? R.mask(gost.account) + ' — ' + t.label : 'не указан') + '.',
            'Сумма в коде: ' + (gost.sum != null ? rub(gost.sum) : 'не указана') + '.'] });
        if (gost.sum != null && pageSums.length && !pageSums.includes(gost.sum)) {
          out.push({ severity: 'warning', title: 'Сумма в QR-коде не совпадает с суммой на странице',
            details: ['В QR: ' + rub(gost.sum) + ', на странице: ' + pageSums.map(rub).join(', ') + '.'] });
        }
        const nameWord = (gost.name || '').replace(/["«»]/g, '').split(/\s+/).find((w) => w.length > 3 && !/^(ООО|АО|ПАО|ИП)$/.test(w));
        if (nameWord && !ctx.text.toLowerCase().includes(nameWord.toLowerCase())) {
          out.push({ severity: 'warning', title: 'Получатель в QR-коде не тот, кто указан на странице',
            details: ['В коде получатель «' + gost.name + '», а на странице это имя не упоминается. Так выглядит подклеенный поверх настоящего QR-код.'] });
        }
      } else if (sbp) {
        if (!sbp.official) {
          out.push({ severity: 'danger', title: 'QR-код похож на СБП, но ведёт на чужой адрес',
            details: ['Адрес в коде: ' + sbp.host + '. Настоящие QR-коды СБП ведут только на https://qr.nspk.ru/.'] });
        } else {
          out.push({ severity: 'info', title: 'QR-код Системы быстрых платежей',
            details: ['Получатель зашит не в картинку, а хранится в НСПК: банк покажет его название перед оплатой — сверьте его с продавцом.',
              sbp.sum != null ? 'Сумма в коде: ' + rub(sbp.sum) : 'Сумма не зашита — её введёте вы сами (статический QR).'] });
          if (sbp.sum != null && pageSums.length && !pageSums.includes(sbp.sum)) {
            out.push({ severity: 'warning', title: 'Сумма в QR-коде не совпадает с суммой на странице', details: ['В QR: ' + rub(sbp.sum) + ', на странице: ' + pageSums.map(rub).join(', ') + '.'] });
          }
        }
      } else if (/^https?:\/\//i.test(q.raw)) {
        const host = D.hostOf(q.raw);
        out.push({ severity: /^http:/i.test(q.raw) ? 'warning' : 'info', title: 'QR-код содержит ссылку на сайт',
          details: ['Ссылка ведёт на ' + host + '. Это не платёжный код: оплата пройдёт на том сайте — проверьте его адрес.'] });
      } else {
        out.push({ severity: 'info', title: 'QR-код не платёжный', details: ['Содержимое: ' + q.raw.slice(0, 60)] });
      }
    }
    // Платёжные ссылки СБП: на телефоне QR не сканируют, а нажимают кнопку «Оплатить через СБП».
    // Ссылка внутри кнопки — то же, что QR-код: настоящая ведёт только на https://qr.nspk.ru/.
    const seenLinks = new Set();
    for (const a of ctx.doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      let abs = '';
      try { abs = new URL(href, ctx.url).href; } catch (e) { continue; }
      const looksSbp = /сбп|sbp|быстрых платеж/i.test(D.label(a) + ' ' + abs);
      const link = R.parseSbpLink(abs);
      if (!looksSbp || !link || seenLinks.has(link.host)) continue;
      seenLinks.add(link.host);
      if (!link.official) {
        out.push({ severity: 'danger', title: 'Кнопка «' + D.label(a).slice(0, 40) + '» ведёт не в Систему быстрых платежей',
          details: ['Адрес ссылки: ' + link.host + '. Настоящие платёжные ссылки СБП ведут только на https://qr.nspk.ru/ и открывают приложение вашего банка.',
            'Поддельная страница «оплаты через СБП» соберёт данные карты или отправит деньги на счёт мошенника.'] });
      } else if (link.sum != null && pageSums.length && !pageSums.includes(link.sum)) {
        out.push({ severity: 'warning', title: 'Сумма в ссылке СБП не совпадает с суммой на странице',
          details: ['В ссылке: ' + rub(link.sum) + ', на странице: ' + pageSums.map(rub).join(', ') + '.'] });
      }
    }
    return out;
  };

  // 7. Разные суммы в одном заказе (скрытые платежи)
  CHECKS['amount-mismatch'] = (ctx) => {
    const totals = [];
    for (const m of ctx.text.matchAll(/(итого|к оплате|сумма заказа|всего|стоимость заказа)[^\d]{0,25}([\d  ]+(?:[.,]\d{1,2})?\s?(?:₽|руб))/gi)) totals.push(...amountsIn(m[2]));
    const out = [];
    // Цена-приманка без слова «итого»: «Премиум за 29 ₽», «доступ за 1 рубль». Тогда за нынешнюю сумму берём
    // самую маленькую сумму на странице (до 99 ₽) — по ней дальше сравниваются будущие списания.
    // Так устроена настоящая ловушка oplata.poslaniya.su (urlscan, 07.11.2026): 29 ₽, затем 1499 ₽ в неделю.
    const teaser = !totals.length && ctx.amounts.length && Math.min(...ctx.amounts) <= 99 ? [Math.min(...ctx.amounts)] : [];
    if (!totals.length && !teaser.length) return [];
    for (const b of totals.length ? ctx.doc.querySelectorAll('button,input[type=submit],a[href]') : []) {
      const label = D.label(b);
      if (!PAY_WORDS.test(label)) continue;
      const onButton = amountsIn(label).filter((a) => !totals.includes(a));
      if (onButton.length) out.push({ severity: 'warning', title: 'Сумма на кнопке оплаты больше суммы заказа', details: ['Заказ: ' + totals.map(rub).join(', ') + ', кнопка «' + label + '».'] });
    }
    for (const h of totals.length ? ctx.doc.querySelectorAll('form input[type=hidden]') : []) {
      if (!/amount|sum|сумм|total|price/i.test(h.name)) continue;
      const v = Number(String(h.value).replace(',', '.'));
      if (v && !totals.includes(v) && !totals.includes(v / 100)) {
        out.push({ severity: 'warning', title: 'Форма скрыто передаёт другую сумму', details: ['На экране: ' + totals.map(rub).join(', ') + ', а в скрытом поле «' + h.name + '» — ' + rub(v) + '.'] });
      }
    }
    // «Подписка за 1 рубль»: на экране символическая сумма, а согласие на регулярные списания спрятано —
    // в мелком шрифте, в заранее отмеченной галочке или в скрытом поле формы.
    const SUBSCR = /подписк|автоплат[её]ж|автопродлен|автосписан|регулярн[а-яё]* (?:списан|плат)|рекуррент/i;
    const RECUR = /далее|затем|ежемесячн|в месяц|\/\s?мес|каждые\s+\d+|раз в\s+(?:\d+\s+)?(?:дн|недел|месяц)|после[^.!?\n]{0,40}(?:период|дн[яе]й)|по истечении[^.!?\n]{0,40}период|за неделю|в неделю|за \d+ дн[яе]й|автоматическ[а-яё]* списан|продлева|автопродлен/i;
    const maxTotal = Math.max(...totals, ...teaser);
    // Самые «глубокие» видимые элементы с нужным текстом: по ним узнаём размер шрифта, которым он набран.
    const deepest = (test) => [...ctx.doc.querySelectorAll('body *')].filter((el) => !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) &&
      el.textContent.length < 700 && test(el.textContent) && D.isRendered(el) && ![...el.children].some((c) => test(c.textContent)));
    const fontPx = (el) => parseFloat(ctx.win.getComputedStyle(el).fontSize) || 16;
    if (RECUR.test(ctx.text)) {
      // Для цены-приманки будущие списания должны быть хотя бы в 10 раз больше: иначе это просто прайс-лист.
      const lim = teaser.length ? maxTotal * 10 : maxTotal;
      const later = deepest((t) => RECUR.test(t) && amountsIn(t).some((a) => a > lim))[0];
      if (later) {
        const sums = amountsIn(later.textContent).filter((a) => a > lim);
        // Мелкий шрифт — признак сокрытия. Для цены-приманки достаточно и самих условий: в 20+ раз больше и каждую неделю
        // или каждые несколько дней. Честные пробные подписки («месяц за 1 ₽, далее 399 ₽ в месяц») списывают помесячно.
        const shortPeriod = /за неделю|в неделю|еженедельн|за \d+ дн[яе]й|каждые \d+ дн/i.test(later.textContent);
        const small = fontPx(later) <= 11 || D.effectiveOpacity(later) < 0.6 || (teaser.length > 0 && shortPeriod && Math.max(...sums) >= maxTotal * 20);
        out.push({ severity: small ? 'warning' : 'info',
          title: teaser.length && small ? 'Цена-приманка: сейчас ' + rub(maxTotal) + ', а дальше — регулярные списания по ' + rub(Math.max(...sums))
            : small ? 'Будущие списания указаны мелким шрифтом' : 'После первой оплаты будут регулярные списания',
          details: ['Сейчас к оплате ' + rub(maxTotal) + ', а дальше с карты будут списывать ' + sums.map(rub).join(', ') + '.',
            'Условие на странице: «' + later.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) + '»' + (small ? ' — набрано шрифтом ' + Math.round(fontPx(later)) + ' px.' : '.')] });
      }
    }
    for (const box of ctx.doc.querySelectorAll('input[type=checkbox]')) {
      if (!box.defaultChecked) continue; // отметку поставил сайт, а не человек
      const label = [...(box.labels || [])].map((l) => l.textContent).join(' ') || (box.parentElement ? box.parentElement.textContent : '');
      if (!SUBSCR.test(label) && !/платн[а-яё]+ (?:услуг|доступ|опци)|страхов/i.test(label)) continue;
      out.push({ severity: 'warning', title: 'Согласие на платную услугу отмечено заранее',
        details: ['Галочка уже стоит: «' + label.replace(/\s+/g, ' ').trim().slice(0, 140) + '».',
          'Согласие на дополнительные платные услуги нельзя получать заранее проставленной отметкой (ст. 16 закона «О защите прав потребителей»). Снимите галочку, если услуга вам не нужна.'] });
      break;
    }
    const flag = [...ctx.doc.querySelectorAll('form input[type=hidden]')].find((h) => /recurr|rebill|auto_?pay|auto_?renew|subscri/i.test(h.name) && !/^(|0|false|no|off)$/i.test(String(h.value).trim()));
    if (flag && !deepest((t) => SUBSCR.test(t)).some((el) => fontPx(el) >= 13)) {
      out.push({ severity: 'warning', title: 'Форма скрыто включает регулярные списания',
        details: ['В форме оплаты есть скрытое поле «' + flag.name + '=' + String(flag.value).slice(0, 20) + '» — признак подписки с автоматическими списаниями. Обычным шрифтом о подписке на странице не сказано.'] });
    }
    return out;
  };

  // 8. Кнопка обещает одно, а делает другое
  CHECKS['deceptive-button'] = (ctx) => {
    const out = [];
    const harmless = /бесплатн|получить|подарок|продолжить|закрыть|отмена|нет, спасибо|далее|проверить|посмотреть|согласен/i;
    const paying = /(?:^|[^a-z])(?:pay|checkout|subscribe|charge|purchase|transfer)(?![a-z])|оплат|подписк|списан|перевод/i; // «payout» (выплата) не считается оплатой
    for (const el of ctx.doc.querySelectorAll('a[href],button,input[type=submit]')) {
      if (!D.isRendered(el) || D.effectiveOpacity(el) < 0.1) continue;
      const visible = D.label(el);
      if (!harmless.test(visible) || paying.test(visible)) continue;
      const form = el.form || el.closest('form');
      const actual = [el.getAttribute('href'), el.getAttribute('formaction'), form && form.getAttribute('action'),
        el.getAttribute('aria-label'), el.title, el.dataset && el.dataset.action].filter(Boolean).join(' ');
      if (paying.test(actual)) {
        out.push({ severity: 'warning', title: 'Кнопка «' + visible + '» на самом деле ведёт к оплате',
          details: ['Видимая надпись безобидная, а адрес/описание кнопки: ' + actual.slice(0, 140)] });
      }
    }
    return out;
  };

  // 9. Невидимый элемент перехватывает нажатие (кликджекинг)
  // Раньше проверка ругалась на любой прозрачный элемент и на «большой прозрачный слой» вообще —
  // а это обычный приём вёрстки, отсюда ложные тревоги. Теперь тревога только при двух условиях:
  //   1) невидимый элемент лежит поверх ВИДИМОЙ кнопки (то есть реально перехватит нажатие);
  //   2) это прозрачный iframe (классическая атака: внутрь мы не видим, но сам приём и есть атака)
  //      ИЛИ собственное действие невидимого элемента — оплата, перевод, подтверждение, подписка.
  CHECKS['clickjacking'] = (ctx) => {
    const out = [];
    const all = [...ctx.doc.querySelectorAll(D.CLICKABLE)].filter(D.isRendered);
    const invisible = all.filter((el) => D.effectiveOpacity(el) < 0.1 && ctx.win.getComputedStyle(el).pointerEvents !== 'none');
    const visible = all.filter((el) => D.effectiveOpacity(el) > 0.5);
    for (const inv of invisible) {
      const r = rectOf(inv);
      if (r.w * r.h < 400) continue; // крошечные элементы нажатие не перехватят
      const covered = visible.find((v) => v !== inv && !inv.contains(v) && !v.contains(inv) && overlap(rectOf(v), r) > 0.5
        && receivesClick(ctx.doc, ctx.win, v, inv));
      if (!covered) continue; // условие 1: невидимый слой не лежит поверх видимой кнопки — перехватывать нечего
      const isFrame = inv.tagName === 'IFRAME';
      const target = [inv.getAttribute('href'), inv.getAttribute('src'), inv.getAttribute('action'),
        inv.getAttribute('formaction'), D.label(inv)].filter(Boolean).join(' ');
      if (!isFrame && !PAY_ACTION.test(target)) continue; // условие 2: обычная прозрачная ссылка — не атака
      out.push({ severity: 'danger', title: 'Невидимый слой перехватывает нажатие на кнопку',
        details: ['Вы видите «' + D.label(covered) + '», но нажатие получит прозрачный ' + inv.tagName.toLowerCase() +
          (isFrame ? ' — встроенное окно другой страницы, его содержимое скрыто' : ' с действием «' + target.slice(0, 80) + '»') + '.',
          'Так нажатие на безобидную кнопку превращается в подтверждение оплаты, перевода или подписки.'] });
    }
    return out;
  };

  // 10. Поддельная форма поверх настоящей / поле карты, вставленное скриптом
  CHECKS['form-overlay'] = (ctx) => {
    const out = [];
    const cards = ctx.fields.filter((f) => f.kind === 'cardNumber').map((f) => f.el).filter(D.isRendered);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        if (cards[i].form !== cards[j].form && overlap(rectOf(cards[i]), rectOf(cards[j])) > 0.3) {
          out.push({ severity: 'danger', title: 'Одна форма оплаты наложена поверх другой', details: ['На странице две формы для номера карты в одном и том же месте экрана — пользователь видит только верхнюю.'] });
        }
      }
    }
    for (const fr of ctx.doc.querySelectorAll('iframe')) {
      const host = D.hostOf(fr.src, ctx.url);
      if (!isPsp(host) || !D.isRendered(fr)) continue;
      if (cards.some((c) => overlap(rectOf(c), rectOf(fr)) > 0.3)) {
        out.push({ severity: 'danger', title: 'Поверх окна платёжного провайдера нарисована своя форма',
          details: ['Окно оплаты ' + host + ' перекрыто полями ввода карты самой страницы. Так веб-скиммеры подменяют защищённую форму банка.'] });
      }
    }
    // Современные магазины часто рисуют форму скриптом — само по себе это нормально.
    // Подозрительно, когда оплата идёт через окно провайдера, а скрипт добавил ещё и своё поле карты.
    const pspFrames = [...ctx.doc.querySelectorAll('iframe')].filter((fr) => isPsp(D.hostOf(fr.src, ctx.url)));
    if (ctx.sensors.addedCardFields > 0 && pspFrames.length && !out.length) {
      out.push({ severity: 'warning', title: 'Поле для номера карты добавлено скриптом после загрузки',
        details: ['Форма появилась не в исходном коде страницы, а была вставлена позже. Так работают внедрённые поддельные формы оплаты.'] });
    }
    return out;
  };

  // 11. Сторонний и запутанный код на странице оплаты (PCI DSS 6.4.3)
  CHECKS['script-inventory'] = (ctx) => {
    if (!ctx.paymentContext) return [];
    const out = [];
    const foreign = [...new Set(ctx.scripts.filter((s) => s.src && D.siteOf(s.host) !== ctx.site && !isPsp(s.host)).map((s) => s.host))];
    if (foreign.length && ctx.has('cardNumber')) {
      out.push({ severity: 'info', title: 'На странице оплаты работает код сторонних сайтов',
        details: ['Подключены скрипты: ' + foreign.join(', ') + '. Любой из них может читать поля формы.'] });
    }
    const OBF = [[/eval\s*\(/, 'eval()'], [/new\s+Function\s*\(/, 'new Function()'], [/String\.fromCharCode\((?:\s*\d+\s*,){8,}/, 'String.fromCharCode(…)'],
      [/(?:\\x[0-9a-f]{2}){12,}/i, 'шестнадцатеричные строки'], [/['"][A-Za-z0-9+/]{120,}={0,2}['"]/, 'длинная base64-строка'], [/document\.write\s*\(\s*unescape/, 'document.write(unescape())']];
    // Запутанность сама по себе ничего не доказывает: сжатый код честных библиотек (Яндекс Метрика, ядро Битрикса)
    // содержит eval, new Function, длинные base64-строки. Предупреждаем, только если на странице есть поле карты
    // и запутанный скрипт сам обращается к полям карты и умеет отправлять данные — так выглядит спрятанный скиммер.
    const cardOnPage = ['cardNumber', 'cvv', 'expiry'].some((k) => ctx.has(k));
    for (const s of cardOnPage ? ctx.scripts : []) {
      const tricks = OBF.filter(([re]) => re.test(s.code)).map(([, n]) => n);
      const all = s.code + revealHidden(s.code); // вместе с тем, что спрятано в atob(…) и String.fromCharCode(…)
      const touchesCard = /(cc-?number|card.?num|cvv|cvc|cc-csc|cc-exp|['"]cc-|autocomplete)/i.test(all) &&
        /fetch\s*\(|XMLHttpRequest|sendBeacon|new\s+Image|WebSocket/.test(all);
      if (tricks.length && touchesCard) {
        out.push({ severity: 'warning', title: 'Запутанный (обфусцированный) код на странице оплаты',
          details: ['Скрипт «' + s.name + '» прячет свой смысл: ' + tricks.join(', ') + '. Честному коду формы оплаты незачем скрываться.'] });
      }
    }
    return out;
  };

  // 12. Скиммер: код читает поля карты и отправляет их на чужой адрес
  CHECKS['skimmer'] = (ctx) => {
    const out = [];
    // Разбор кода — только если на странице есть поле карты: без него скиммеру нечего читать.
    // Иначе большие скрипты обычных сайтов (поиск Google с его автодополнением) давали ложное «подозрительно».
    const cardOnPage = ['cardNumber', 'cvv', 'expiry'].some((k) => ctx.has(k));
    for (const s of cardOnPage ? ctx.scripts : []) {
      const code = s.code + revealHidden(s.code);
      const readsCard = /(cc-?number|card.?num|cardnumber|cvv|cvc|cc-csc|cc-exp|autocomplete[^;\n]{0,30}cc-)/i.test(code) &&
        /(\.value\b|addEventListener\(\s*['"](?:input|change|blur|keyup|keydown|submit)|onsubmit|new\s+FormData)/.test(code);
      const sink = code.match(/fetch\s*\(|XMLHttpRequest|sendBeacon|new\s+Image|WebSocket/);
      if (!readsCard || !sink) continue;
      const urls = [...code.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase())
        .filter((h) => D.siteOf(h) !== ctx.site && !isPsp(h));
      const telegram = /api\.telegram\.org\/bot/i.test(code);
      out.push({ severity: 'warning', title: 'Скрипт читает поля карты и умеет отправлять данные',
        details: ['Скрипт «' + s.name + '» обращается к полям карты и использует ' + sink[0].replace(/\s*\($/, '') + '.' +
          (urls.length ? ' В коде найден посторонний адрес: ' + [...new Set(urls)].join(', ') + '.' : ' Адрес отправки в коде не найден.'),
          telegram ? 'Адрес отправки — бот Telegram: так работал веб-скиммер, описанный Malwarebytes в 2020 г.'
            : 'Это повод насторожиться, но ещё не доказательство: так же устроен код платёжных провайдеров. Решающий признак — что уйдёт в сеть после ввода карты.'] });
    }
    // Поведение важнее текста кода: код скиммера почти всегда запутан, а отправку данных спрятать нельзя.
    //   опасно        — в запросе на посторонний сайт найден номер введённой карты (открыто, в URL-кодировке или base64);
    //   подозрительно — после ввода карты страница впервые обратилась к постороннему сайту;
    //   к сведению    — после ввода были запросы только к тем сайтам, с которыми страница работала и раньше (аналитика).
    const net = ctx.sensors.network || [];
    const foreign = (n) => n.host && D.siteOf(n.host) !== ctx.site && !isPsp(n.host) && !D.isLocalHost(n.host);
    const before = new Set(net.filter((n) => !n.afterCardInput && n.host).map((n) => n.host));
    const after = net.filter((n) => n.afterCardInput && foreign(n));
    const stolen = [];
    for (const n of after) {
      const how = cardInPayload((n.url || '') + '\n' + (n.body || ''), ctx.sensors.cardDigits);
      if (how) stolen.push(n.host + ' (' + n.how + ', номер карты ' + how + ')');
    }
    if (stolen.length) {
      out.push({ severity: 'danger', title: 'Номер введённой карты отправлен на посторонний сайт',
        details: ['Запросы: ' + [...new Set(stolen)].join('; ') + '.', 'Так веб-скиммер (Magecart) крадёт данные карты. Не завершайте оплату на этой странице.'] });
    } else if (after.length) {
      const fresh = [...new Set(after.filter((n) => !before.has(n.host)).map((n) => n.host + ' (' + n.how + ')'))];
      if (fresh.length) {
        out.push({ severity: 'warning', title: 'После ввода карты страница впервые обратилась к постороннему сайту',
          details: ['Новые адреса: ' + fresh.join(', ') + '. Номера карты в запросах не видно — данные могли быть зашифрованы.'] });
      } else {
        out.push({ severity: 'info', title: 'После ввода карты были обычные запросы к сторонним сайтам',
          details: ['Адреса: ' + [...new Set(after.map((n) => n.host))].join(', ') + '. Страница обращалась к ним и до ввода карты (обычно это аналитика); номера карты в запросах нет.'] });
      }
    }
    return out;
  };

  // 13. Подмена реквизитов после загрузки страницы
  CHECKS['requisites-swap'] = (ctx) => ctx.sensors.changes.map((c) => ({
    severity: 'danger', title: 'Реквизиты на странице подменились',
    details: ['Через ' + (Math.round(c.afterMs / 100) / 10).toLocaleString('ru-RU') + ' с после открытия ' + c.kind + ' ' + c.from + ' заменилась на ' + c.to + '. Так вредоносный код подставляет свои реквизиты в настоящий счёт.'],
  }));

  // 14. Давление и срочность рядом с оплатой
  CHECKS['pressure'] = (ctx) => {
    if (!ctx.paymentContext) return [];
    const P = [/срочно/i, /немедленно/i, /только сегодня/i, /осталось\s+\d+\s*(?:мин|час|сек)/i, /в течение\s+\d+\s*(?:мин|час)/i,
      /иначе[^.]{0,40}(отмен|заблок|сгор|аннулир|спиш)/i, /последний шанс/i, /(бронь|заказ|ссылка)[^.]{0,20}истека/i, /\b\d{1,2}:\d{2}\b(?=[^.]{0,30}(?:остал|истека))|(?:остал|истека)[^.]{0,30}\b\d{1,2}:\d{2}\b/i];
    const t = ctx.text, hits = [], sentences = new Set();
    for (const re of P) {
      const m = t.match(re);
      if (!m) continue;
      hits.push(m[0]);
      // цитируем всё предложение, в котором найдена фраза
      const start = Math.max(t.lastIndexOf('.', m.index), t.lastIndexOf('!', m.index), t.lastIndexOf('\n', m.index)) + 1;
      const ends = ['.', '!', '\n'].map((c) => t.indexOf(c, m.index + m[0].length)).filter((i) => i >= 0);
      sentences.add(t.slice(start, ends.length ? Math.min(...ends) + 1 : t.length).trim().slice(0, 140));
    }
    if (!hits.length) return [];
    return [{ severity: hits.length >= 2 ? 'warning' : 'info', title: 'Вас торопят',
      details: ['На странице: «' + [...sentences].slice(0, 3).join('» «') + '»', 'Спешка мешает проверить получателя — это стандартный приём социальной инженерии.'] }];
  };

  // 15. ClickFix: поддельная «капча» просит вставить команду в окно «Выполнить»
  CHECKS['clickfix'] = (ctx) => {
    // Текст и скрипты самой страницы и её встроенных окон того же сайта (iframe srcdoc): настоящие наборы
    // прячут поддельную капчу во вложенный документ, и в тексте основной страницы инструкции нет.
    const docs = [ctx.doc];
    for (const fr of ctx.doc.querySelectorAll('iframe')) {
      try { if (fr.contentDocument && fr.contentDocument.body) docs.push(fr.contentDocument); } catch (e) { /* чужое окно недоступно */ }
    }
    // Инструкцию ищем во всём тексте, в том числе скрытом: шаги «Win+R → Ctrl+V» показываются только после нажатия
    // на «капчу», а предупредить нужно до него. Код скриптов и стилей в текст не попадает.
    const allText = (d) => {
      const out = [], walk = d.createTreeWalker(d.body, 4);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentNode.nodeName)) out.push(n.nodeValue);
      }
      return out.join(' ').replace(/\s+/g, ' ');
    };
    const text = docs.map(allText).join('\n');
    const codes = ctx.scripts.map((s) => s.code).concat(docs.slice(1).flatMap((d) => [...d.querySelectorAll('script:not([src])')].map((s) => s.textContent)));
    // Инструкция: открыть окно запуска команд и вставить туда текст. Встречается в двух вариантах:
    //   Win+R (окно «Выполнить») → Ctrl+V → Enter;  Win+X → «Windows PowerShell»/«Терминал» → Ctrl+V → Enter.
    // Клавишу Win часто рисуют картинкой — тогда в тексте остаётся только «+ R» / «+ X».
    const OPEN = /(?:win(?:dows)?(?:\s*key)?\s*\+\s*[rx]\b|⊞\s*\+\s*[rx]\b|(?:^|\s)\+\s*[rx]\b|окно\s*«?выполнить»?|run dialog|windows powershell|терминал|terminal)/i;
    const PASTE = /ctrl\s*\+\s*v|вставьте|paste/i;
    let instr = null;
    for (const m of text.matchAll(new RegExp(OPEN.source, 'gi'))) {
      const tail = text.slice(m.index, m.index + 400);
      if (PASTE.test(tail) && /enter|ввод/i.test(tail)) { instr = tail.slice(0, (tail.search(/enter|ввод/i) || 140) + 5); break; }
    }
    const clipWrite = codes.some((c) => /clipboard\.writeText|execCommand\(\s*['"]copy/.test(c + revealHidden(c)));
    const command = codes.some((c) => /powershell|mshta|cmd(?:\.exe)?\s*\/c|iwr\s|invoke-webrequest|curl\s|bitsadmin|rundll32|msiexec/i.test(c + revealHidden(c)) &&
      /clipboard\.writeText|execCommand\(\s*['"]copy/.test(c + revealHidden(c)));
    // «Опасно»: инструкция (вставить в окно запуска команд) или скрипт, который кладёт в буфер команду Windows.
    // Одна запись в буфер без инструкции и без команды — обычная кнопка «Скопировать», тревоги нет.
    if (!instr && !command) {
      // Первый шаг ClickFix: страница показывает флажок «я не робот», а инструкцию подгружает уже после нажатия.
      // Настоящую проверку (Cloudflare Turnstile, reCAPTCHA, hCaptcha, Яндекс SmartCaptcha) всегда загружает сервер
      // провайдера. Если фраза стоит в коротком элементе самой страницы, а кода провайдера нет — проверка нарисована.
      const PHRASE = /i'?m not a robot|i am not a robot|verify (?:that )?you are (?:a )?human|я не робот|checking if you are human|je ne suis pas un robot/i;
      const PROVIDER = /challenges\.cloudflare\.com|google\.com\/recaptcha|recaptcha\.net|gstatic\.com\/recaptcha|hcaptcha\.com|smartcaptcha|captcha-api\.yandex|arkoselabs|funcaptcha|geetest/i;
      const drawn = docs.some((d) => [...d.querySelectorAll('label, span, div, p, button, h1, h2')].some((el) =>
        el.children.length <= 2 && el.textContent.length < 80 && PHRASE.test(el.textContent)));
      const provider = docs.some((d) => [...d.querySelectorAll('script[src], iframe[src]')].some((el) => PROVIDER.test(el.getAttribute('src'))));
      if (!drawn || provider) return [];
      return [{ severity: 'warning', title: 'Проверка «я не робот» нарисована самой страницей',
        details: ['На странице флажок «я не робот», но кода настоящей службы проверки (Cloudflare, reCAPTCHA, hCaptcha, Яндекс) нет.',
          'Так начинается ClickFix: после нажатия страница попросит нажать Win+R или открыть PowerShell и вставить команду. Не выполняйте никаких шагов с клавиатурой.'] }];
    }
    const details = [];
    if (instr) details.push('Инструкция на странице: «' + instr.replace(/\s+/g, ' ').trim().slice(0, 160) + '».');
    if (command) details.push('Скрипт страницы кладёт в буфер обмена команду для Windows (PowerShell, mshta или cmd). После вставки и Enter она скачает и запустит вредоносную программу.');
    else if (clipWrite) details.push('Скрипт страницы при нажатии на «проверку» записывает что-то в буфер обмена — это и есть команда, которую просят вставить.');
    if (instr && !ctx.text.replace(/\s+/g, ' ').includes(instr.replace(/\s+/g, ' ').trim().slice(0, 15))) {
      details.push('Инструкция пока скрыта: она появится после нажатия на «проверку»' + (docs.length > 1 ? ' и лежит во встроенном окне страницы' : '') + '. Не нажимайте её.');
    }
    details.push('Настоящая капча никогда не просит открывать окно «Выполнить», PowerShell или терминал и что-то туда вставлять.');
    return [{ severity: 'danger', title: 'Поддельная проверка «я не робот»: вас просят запустить команду', details }];
  };

  // 16. Фейковое «приложение банка» (.apk) и программы удалённого доступа (схема NFCGate / NGate)
  CHECKS['fake-app'] = (ctx) => {
    const out = [];
    const apks = [...ctx.doc.querySelectorAll('a[href]')].filter((a) => /\.apk(?:$|[?#])/i.test(a.getAttribute('href')) || /\.apk$/i.test(a.getAttribute('download') || ''));
    const risky = /(банк|служб[а-яё]* безопасности|защит|отмен[а-яё]* операц|госуслуг|возврат|бесконтактн|nfc|карт)/i.test(ctx.text);
    if (apks.length) {
      out.push({ severity: risky ? 'danger' : 'warning', title: 'Предлагают установить приложение из файла .apk, а не из магазина приложений',
        details: ['Ссылка: «' + D.label(apks[0]) + '» → ' + apks[0].getAttribute('href').slice(0, 80) + '.',
          'Так распространяют поддельные «банковские» приложения: они перехватывают SMS и данные карты (схемы NFCGate, NGate). Банки публикуют приложения только в официальных магазинах и на своём сайте.'] });
    }
    const rat = ctx.text.match(/(anydesk|rustdesk|teamviewer|rudesktop|airdroid|ammyy|quick ?support|демонстраци[а-яё]* экрана)/i);
    if (rat && /(установите|скачайте|включите|запустите|продиктуйте|сообщите)/i.test(ctx.text) && risky) {
      out.push({ severity: 'danger', title: 'Просят установить программу удалённого доступа',
        details: ['На странице упоминается «' + rat[0] + '». Через неё мошенник видит экран и сам подтверждает переводы в вашем банковском приложении. Сотрудники банка никогда об этом не просят.'] });
    }
    return out;
  };

  // 17. Домен-двойник: буквы другого алфавита в адресе (IDN-омограф)
  CHECKS['homograph'] = (ctx) => {
    const out = [], seen = new Set();
    const hosts = [[ctx.host, 'адрес этой страницы']];
    for (const a of ctx.doc.querySelectorAll('a[href], form[action]')) {
      const h = D.hostOf(a.getAttribute('href') || a.getAttribute('action'), ctx.url);
      if (h) hosts.push([h, 'ссылка «' + D.label(a) + '»']);
    }
    for (const [h, where] of hosts) {
      if (seen.has(h) || !h.includes('xn--')) continue;
      seen.add(h);
      const r = D.readableHost(h);
      if (r.mixed) {
        out.push({ severity: 'danger', title: 'Адрес-двойник: в домене смешаны латинские и русские буквы',
          details: [where + ': выглядит как «' + r.unicode + '», а на самом деле это ' + h + '.',
            'Буквы «а», «е», «о», «р», «с» в кириллице и латинице выглядят одинаково — так подделывают адреса банков и магазинов.'] });
      } else if (ctx.paymentContext) {
        out.push({ severity: 'info', title: 'Адрес на национальном алфавите', details: [where + ': ' + r.unicode + ' (' + h + '). Убедитесь, что это нужный сайт.'] });
      }
    }
    return out;
  };

  // 18. Browser-in-the-Browser: окно входа с «адресной строкой», нарисованное внутри страницы
  CHECKS['bitb'] = (ctx) => {
    const out = [];
    const boxes = [...ctx.doc.querySelectorAll('div, section, dialog, aside')].filter((el) => {
      const st = ctx.win.getComputedStyle(el);
      if (!['fixed', 'absolute'].includes(st.position) || !D.isRendered(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 250 && r.height >= 200 && el.querySelector('input, iframe');
    });
    for (const box of boxes) {
      // В наборах BitB (mr.d0x) форма входа часто лежит во фрейме внутри нарисованного окна — его тоже считаем.
      const sensitive = [...box.querySelectorAll('input')].some((i) => i.type === 'password' || D.fieldKind(i)) || !!box.querySelector('iframe');
      const fakeUrl = (box.innerText || '').match(/(?:https?:\/\/|🔒\s*)([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/\S*)?/i);
      if (!sensitive || !fakeUrl) continue;
      if (D.siteOf(fakeUrl[1]) === ctx.site) continue; // окно со своим же адресом — не подделка чужого сайта
      // настоящее всплывающее окно браузера не является частью страницы — значит, это рисунок
      out.push({ severity: 'danger', title: 'Поддельное окно браузера внутри страницы',
        details: ['Внутри страницы нарисовано «окно» с адресной строкой «' + fakeUrl[0].slice(0, 60) + '» и полями для входа.',
          'Настоящее окно входа открывает сам браузер, его можно вытащить за пределы страницы. Это окно — часть страницы ' + ctx.host + ', и данные уйдут ей.'] });
      break;
    }
    return out;
  };

  // Что делать человеку, если проверка сработала. Одно-два действия, которые можно выполнить сразу.
  const ADVICE = {
    'card-form': 'Не вводите данные карты. Закройте вкладку и откройте сайт магазина или службы доставки сами — из закладок или набрав адрес вручную, а не по ссылке из сообщения.',
    'receive-money': 'Ничего не вводите. Чтобы получить перевод, достаточно номера карты или телефона — срок действия, CVV и баланс для этого не нужны.',
    'secret-codes': 'Не вводите код. Прочитайте само SMS: в нём написано, что именно подтверждает код (сумма и магазин или вход в банк). Если не совпадает с тем, что вы делаете, — закройте страницу.',
    'manual-transfer': 'Не переводите деньги человеку. Попросите оплату через платёжную форму сайта или счёт организации; если «оплата не работает» — откажитесь от покупки.',
    'recipient': 'Сверьте получателя с договором, квитанцией или официальным сайтом организации. Если просят перевести деньги на «безопасный счёт» — положите трубку и позвоните в банк по номеру на карте.',
    'qr-code': 'Не платите по этому коду или ссылке. Оплатите через приложение банка, найдя организацию по ИНН или названию, либо в личном кабинете на её официальном сайте.',
    'amount-mismatch': 'Не подтверждайте оплату, пока не увидите полную сумму и условия. Если подписка не нужна — снимите галочку или закройте страницу; для разовых покупок удобна отдельная карта с лимитом.',
    'deceptive-button': 'Не нажимайте эту кнопку, пока не найдёте на странице честное название действия и цену. Если отказаться можно только мелкой ссылкой — нажмите её.',
    'clickjacking': 'Не нажимайте на кнопку. Закройте страницу: нажатие получит невидимый элемент, а не то, что вы видите.',
    'form-overlay': 'Не вводите карту в эту форму. Сообщите магазину и оплатите другим способом — настоящая форма банка открывается в собственном окне с адресом платёжного сервиса.',
    'script-inventory': 'Не вводите карту на этой странице. Если покупка нужна — оплатите через СБП или при получении и сообщите магазину о постороннем коде.',
    'skimmer': 'Не завершайте оплату. Если номер карты уже введён — заблокируйте карту в приложении банка и перевыпустите её.',
    'requisites-swap': 'Не платите по реквизитам с этой страницы. Запросите счёт у организации по другому каналу (телефон из договора) и сверьте номер счёта по цифрам.',
    'pressure': 'Не торопитесь: настоящая бронь или заказ не пропадут за те минуты, что нужны на проверку адреса сайта и получателя.',
    'clickfix': 'Ничего не нажимайте и не вставляйте. Закройте вкладку. Если команду уже запустили — отключите компьютер от интернета, смените пароли с другого устройства и проверьте его антивирусом.',
    'fake-app': 'Не скачивайте файл и не устанавливайте программу. Приложение банка ставится только из магазина приложений или с сайта банка, адрес которого вы набрали сами.',
    'homograph': 'Не переходите по ссылке. Откройте сайт банка или магазина из закладок или набрав адрес вручную.',
    'bitb': 'Не вводите пароль. Попробуйте перетащить это окно за край страницы: настоящее окно браузера выдвигается за её пределы, нарисованное — нет.',
  };

  // =====================================================================
  //  Сборка отчёта
  // =====================================================================
  function describeRecipient(text, qrFound) {
    const req = R.findRequisites(text);
    const items = [];
    for (const c of req.cards) items.push({ kind: 'person', text: 'карта ' + c.system + ' ' + c.masked + ' (личная карта человека)' });
    for (const p of req.phones) {
      if (!R.nearPayment(text, p.at)) continue; // контактный телефон, а не реквизит для перевода
      items.push({ kind: 'person', text: 'перевод по телефону ' + p.masked + ' (через СБП — человеку)' });
    }
    for (const a of req.accounts) {
      const key = req.bic ? R.accountKeyValid(a.value, req.bic) : null;
      items.push({ kind: a.type.kind, text: 'счёт ' + a.masked + ' — ' + a.type.label, invalid: key === false ? 'контрольный ключ счёта не сходится с БИК ' + req.bic : null });
    }
    if (req.inn && !R.innValid(req.inn)) items.push({ kind: 'unknown', text: 'ИНН ' + req.inn, invalid: 'неверные контрольные цифры ИНН' });
    for (const q of qrFound) {
      const g = R.parseGostQr(q.raw);
      if (g && g.account) {
        const t = R.accountType(g.account);
        const key = g.bic ? R.accountKeyValid(g.account, g.bic) : null;
        items.push({ kind: t.kind, text: 'счёт из QR-кода ' + R.mask(g.account) + ' — ' + t.label + (g.name ? ', получатель: ' + g.name : ''), invalid: key === false ? 'контрольный ключ счёта не сходится с БИК ' + g.bic : null });
      }
    }
    if (req.name && items.length) items.push({ kind: 'person', text: 'получатель указан как «' + req.name + '»' });
    return { items, name: req.name };
  }

  async function inspect(doc, sensors, options) {
    sensors = Object.assign({ changes: [], addedCardFields: 0, network: [], cardInputAt: null, cardDigits: null }, sensors || {});
    options = Object.assign({ fetchScripts: true, readQr: true }, options || {});
    // Адрес страницы. Для оценки на сохранённых страницах (lab/eval/one.html) передаётся настоящий адрес,
    // с которого страница была сохранена: иначе у всех страниц был бы адрес локального сервера.
    const loc = options.pageUrl ? new URL(options.pageUrl) : doc.location;
    const win = doc.defaultView;
    const text = ((doc.title || '') + '\n' + (doc.body ? doc.body.innerText : '')).slice(0, 40000);
    const fields = [...doc.querySelectorAll('input,textarea')].map((el) => ({ el, kind: D.fieldKind(el) })).filter((f) => f.kind);
    const qr = options.readQr && root.PGQr ? await root.PGQr.decodeAll(doc) : { found: [], unreadable: [] };
    const ctx = {
      doc, win, text, fields, qr, sensors,
      url: loc.href, host: loc.hostname, protocol: loc.protocol,
      site: D.siteOf(loc.hostname), isLocal: D.isLocalHost(loc.hostname),
      has: (kind) => fields.some((f) => f.kind === kind),
      scripts: await collectScripts(doc, options.fetchScripts, loc),
      amounts: amountsIn(text),
      role: R.pageRole(roleText(doc)),
    };
    ctx.recipient = describeRecipient(text, qr.found);
    // Платёжный объект — то, что реально ведёт к деньгам: поле карты, реквизиты или платёжный QR.
    // Одних слов («перевести», «pay») мало: на обычных страницах они встречаются постоянно.
    const paymentQr = qr.found.some((q) => R.parseGostQr(q.raw) || R.parseSbpLink(q.raw));
    const sbpLink = !!doc.querySelector('a[href*="qr.nspk.ru"]');
    ctx.paymentObject = ctx.has('cardNumber') || ctx.recipient.items.length > 0 || paymentQr || sbpLink;
    ctx.paymentContext = ctx.paymentObject || (PAY_WORDS.test(text) && ctx.amounts.length > 0);

    const findings = [];
    for (const [id, check] of Object.entries(CHECKS)) {
      try {
        // К предупреждению добавляется совет — что человеку сделать прямо сейчас.
        for (const f of check(ctx)) findings.push(Object.assign({ check: id }, f, f.severity === 'danger' || f.severity === 'warning' ? { advice: ADVICE[id] } : {}));
      } catch (e) {
        findings.push({ check: id, severity: 'error', title: 'Проверка завершилась с ошибкой', details: [String(e && e.message || e)] });
      }
    }
    const order = { danger: 0, warning: 1, info: 2, error: 3 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);

    const limits = [];
    if (qr.unreadable.length) limits.push('Не удалось прочитать картинки с другого сайта — QR-коды на них не проверены.');
    if (ctx.scripts.some((s) => s.unreadable)) limits.push('Часть скриптов не удалось загрузить для анализа.');
    if (ctx.has('cardNumber') && !sensors.cardInputAt) limits.push('Проверка отправки данных включится, когда в поле карты начнут вводить номер.');
    limits.push('Содержимое чужих фреймов (окна банков и платёжных сервисов) расширению недоступно.');

    const verdict = findings.some((f) => f.severity === 'danger') ? 'danger'
      : findings.some((f) => f.severity === 'warning') ? 'warning'
      : ctx.paymentObject ? 'ok' : 'none';
    return {
      verdict, findings, limits,
      recipient: ctx.recipient,
      context: { host: ctx.host, role: ctx.role, payment: ctx.paymentContext, cardFields: fields.map((f) => f.kind), qrCodes: qr.found.map((q) => q.raw), scripts: ctx.scripts.map((s) => s.src || s.name), amounts: ctx.amounts },
      checkedAt: new Date().toISOString(),
    };
  }

  const VERDICTS = {
    danger: { title: 'Высокий риск — не платите', tone: 'danger' },
    warning: { title: 'Есть подозрительные признаки', tone: 'warning' },
    ok: { title: 'Явных признаков обмана не найдено', tone: 'ok' },
    none: { title: 'Платёжных действий не найдено', tone: 'none' },
  };

  root.PGChecks = { inspect, CHECK_IDS: Object.keys(CHECKS), VERDICTS, ADVICE, amountsIn };
})(typeof window !== 'undefined' ? window : globalThis);
