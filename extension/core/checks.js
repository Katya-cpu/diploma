/*
 * Анализатор страницы – «мозг» расширения. Этот же файл подключает лаборатория,
 * поэтому администратор видит ровно те решения, которые принимает расширение.
 *
 * inspect(document, sensors) → отчёт:
 *   verdict   – общий итог (danger / warning / ok / none);
 *   findings  – найденные признаки: какая проверка, насколько серьёзно, почему;
 *   recipient – кому уйдут деньги (реквизиты из текста и QR);
 *   limits    – что проверить не удалось (отсутствие данных ≠ безопасность).
 */
(function (root) {
  'use strict';
  const R = root.PGRecipient, D = root.PGDom;

  // Известные платёжные провайдеры: форма или окно оплаты у них – нормальная практика.
  const PSP = ['yookassa.ru', 'yoomoney.ru', 'cloudpayments.ru', 'tbank.ru', 'tinkoff.ru', 'sberbank.ru', 'nspk.ru',
    'robokassa.ru', 'payture.com', 'uniteller.ru', 'payler.com', 'paymaster.ru', 'best2pay.net', 'alfabank.ru', 'vtb.ru',
    'gazprombank.ru', 'stripe.com', 'paypal.com', 'pay-psp.test'];
  const isPsp = (host) => PSP.includes(D.siteOf(host));

  const PAY_WORDS = /оплат|перевед|перевод (?:денег|средств|на)|к оплате|купить|(?:^|[^a-z])(?:pay|checkout)(?![a-z])/i;
  // Обещание человеку получить деньги («получите выплату», «для получения средств», «вывести деньги»).
  // Формы третьего лица («магазин получает оплату», «мы получим перевод») – это рассказ о работе сайта, не приманка.
  const RECEIVE_WORDS = /(получи(?:ть|те)|получени[еяю]|зачисли(?:ть|те|м)|зачислени[еяю]|принять|вывести|вывод)\s+(?:\S+\s+){0,3}(деньг|оплат|выплат|средств|перевод|компенсац)/i;

  function amountsIn(text) {
    const out = [];
    for (const m of String(text).matchAll(/(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?(?:₽|руб)/gi)) {
      out.push(Number(m[1].replace(/\D/g, '') + '.' + (m[2] || '0')));
    }
    return [...new Set(out)];
  }
  const rub = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

  // Найти фразу так, чтобы она не стояла под отрицанием. «Никому не сообщайте код» или
  // «банк никогда не просит переводить на безопасный счёт» – это предупреждение, а не просьба.
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

  // Есть ли номер карты в исходящем запросе – открытым текстом, в URL-кодировке или в base64.
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

  // Кем представляется страница – смотрим только туда, где сайт называет себя: заголовок окна,
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
  // ---------- Сбор скриптов страницы (встроенные + файлы того же сайта или любого в расширении) ----------
  async function collectScripts(doc, allowFetch, loc) {
    loc = loc || doc.location;
    const list = [], pending = [];
    // Код внешних скриптов скачивается параллельно и не дольше 4 с на скрипт. Без ограничения сервер, который держит
    // соединение и не отвечает (так было с копией «Службы безопасности Госуслуг», urlscan, 2026), останавливал всю проверку:
    // панель не появлялась вовсе.
    const load = async (item) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try { item.code = (await (await fetch(item.fetchSrc || item.src, { signal: ctrl.signal })).text()).slice(0, 300000); } catch (e) { item.unreadable = true; }
      clearTimeout(timer);
    };
    for (const s of doc.querySelectorAll('script')) {
      const src = s.getAttribute('src');
      if (!src) { list.push({ name: 'встроенный скрипт', host: loc.hostname, code: s.textContent.slice(0, 200000) }); continue; }
      let url, fetchUrl;
      try { url = new URL(src, loc.href); fetchUrl = new URL(src, doc.baseURI); } catch (e) { continue; }  // битый адрес (бывает на настоящих сайтах) – пропускаем
      // В отчёте – адрес относительно страницы (в лаборатории – её настоящий адрес), а код берётся оттуда, откуда страница открыта.
      const item = { name: url.pathname.split('/').pop() || url.hostname, host: url.hostname, src: url.href, fetchSrc: fetchUrl.href, code: '' };
      if (allowFetch) pending.push(load(item));
      list.push(item);
    }
    await Promise.all(pending);
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
  //  Проверки. Семь тем – семь вопросов, которые человек задал бы перед оплатой:
  //    1. data         – куда уйдут введённые данные (карта, коды, пароли);
  //    2. recipient    – кому уйдут деньги (реквизиты, QR-код, ссылка СБП);
  //    3. charges      – сколько спишут (подписка, скрытая сумма, кнопка-обманка);
  //    4. page-code    – что делает код страницы (скиммер, скрытый загрузчик);
  //    5. pressure     – давят ли на человека (запугивание, долг, обещание дохода, таймер);
  //    6. clickfix     – просят ли запустить команду на компьютере;
  //    7. crypto-wallet – просят ли подключить и подписать криптокошелёк.
  //  Каждая находка: severity, title (факт одной фразой), details (что именно найдено), advice (что делать).
  // =====================================================================
  const CHECKS = {};

  // Что просит страница – словами, понятными человеку.
  const ASK = { cardNumber: 'номер карты', cvv: 'CVV', expiry: 'срок действия карты', pin: 'PIN-код карты', smsCode: 'код из SMS',
    bankPassword: 'кодовое слово или пароль банка', password: 'пароль', mailPassword: 'пароль от почты', ssn: 'номер соцстрахования',
    maiden: 'девичью фамилию матери', balance: 'баланс карты' };
  // Сервисы, которые пересылают содержимое формы владельцу на почту, в чат или таблицу. Честные магазины
  // не принимают через них оплату, а фишинговые наборы пользуются ими постоянно: сервер не нужен.
  const FORM_SERVICES = /(?:^|\.)(?:formsubmit\.co|formspree\.io|getform\.io|usebasin\.com|web3forms\.com|formcarry\.com|staticforms\.xyz|fabform\.io|emailjs\.com|hooks\.zapier\.com|webhook\.site|pipedream\.net|ntfy\.sh)$/i;
  const SERVICE_IN_CODE = /(?:https?:)?\/\/((?:api\.)?(?:formsubmit\.co|formspree\.io|getform\.io|usebasin\.com|web3forms\.com|formcarry\.com|emailjs\.com|webhook\.site|pipedream\.net|ntfy\.sh)|(?:discord(?:app)?\.com\/api\/webhooks)|script\.google\.com\/macros)/i;
  const addrOf = (u) => u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '');

  // ---------------------------------------------------------------- 1. Куда уйдут введённые данные
  CHECKS['data'] = (ctx) => {
    const sens = ctx.fields.filter((f) => ASK[f.kind]);
    if (!sens.length) return [];
    const out = [];
    const askedList = [...new Set(sens.map((f) => ASK[f.kind]))];
    const asked = askedList.join(', ');
    const hasCard = ctx.has('cardNumber');
    // Платёжные секреты: из-за них предупреждаем и про обычные адреса отправки. Один пароль от сайта – нет:
    // формы входа часто отправляются на соседний сайт той же компании.
    const paySecret = sens.some((f) => ['cardNumber', 'cvv', 'smsCode', 'bankPassword', 'pin'].includes(f.kind));
    const code = ctx.scripts.map((s) => s.code + revealHidden(s.code)).join('\n');
    const forms = [...new Set(sens.map((f) => f.el.form).filter(Boolean))];
    const dests = [];
    for (const form of forms) {
      try { dests.push(new URL(form.getAttribute('action') || '', ctx.url)); } catch (e) { /* битый адрес */ }
    }

    // Куда уходят данные – одна, самая точная находка.
    const tg = dests.find((u) => /(^|\.)telegram\.org$/i.test(u.hostname) && /\/bot/i.test(u.pathname)) || /api\.telegram\.org\/bot/i.test(code);
    const svcForm = dests.find((u) => FORM_SERVICES.test(u.hostname));
    const svcCode = !svcForm && code.match(SERVICE_IN_CODE);
    if (tg) {
      out.push({ severity: 'danger', title: 'Введённые данные уходят в Telegram-бота',
        details: ['Страница просит: ' + asked + '. В её коде записан адрес api.telegram.org/bot…: всё введённое сразу придёт в чат Telegram.'],
        advice: 'Ничего не вводите и закройте вкладку. Банки и магазины не принимают данные через Telegram.' });
    } else if (svcForm || svcCode) {
      const where = svcForm ? addrOf(svcForm) : svcCode[1];
      out.push({ severity: 'danger', title: 'Введённые данные уйдут через сервис пересылки форм',
        details: ['Страница просит: ' + asked + '. Форма отправит их на ' + where + ' – сервис, который пересылает заполненные формы владельцу на почту или в чат.'],
        advice: 'Ничего не вводите. Настоящая оплата идёт через банк или платёжный сервис, а не через пересылку формы.' });
    } else if (paySecret) {
      const insecureForm = dests.find((u) => u.protocol === 'http:' && !D.isLocalHost(u.hostname));
      if ((ctx.protocol === 'http:' && !ctx.isLocal) || insecureForm) {
        out.push({ severity: 'danger', title: 'Данные передаются без шифрования',
          details: [insecureForm ? 'Форма отправит ' + asked + ' по адресу http://' + insecureForm.hostname + ' – без HTTPS.'
            : 'Страница открыта по http://, без HTTPS, и просит: ' + asked + '. Любой на пути до сайта может прочитать введённое.'],
          advice: 'Не вводите данные карты на странице без HTTPS.' });
      }
      const other = dests.find((u) => u.protocol !== 'http:' && D.siteOf(u.hostname) !== ctx.site && !isPsp(u.hostname) && !D.isLocalHost(u.hostname));
      if (other) {
        out.push({ severity: 'warning', title: 'Данные уходят на другой сайт',
          details: ['Страница ' + ctx.host + ', а форма отправит ' + asked + ' на ' + addrOf(other) + '.'],
          advice: 'Не вводите данные. Откройте сайт магазина или службы сами, набрав адрес вручную.' });
      }
      // Карту принимает сам сайт: у поля есть name, форма уходит на тот же сайт, платёжного сервиса на странице нет.
      // Честные магазины так почти не делают (это требует сертификации PCI DSS), фишинговые – почти всегда.
      const pspScript = ctx.scripts.some((s) => s.src && isPsp(s.host)) ||
        [...ctx.doc.querySelectorAll('iframe[src]')].some((fr) => isPsp(D.hostOf(fr.getAttribute('src'), ctx.url)));
      const ownCard = hasCard && !pspScript && !insecureForm && !other && (ctx.protocol === 'https:' || ctx.isLocal) &&
        ctx.fields.find((f) => f.kind === 'cardNumber' && f.el.form && f.el.getAttribute('name') &&
          D.siteOf(D.hostOf(f.el.form.getAttribute('action') || '', ctx.url) || ctx.host) === ctx.site);
      // Страница называет себя окном платёжного сервиса, но поля карты – её собственные.
      const CLAIMS = [['Stripe', /powered by\s*stripe|unterstützt von\s*stripe|propulsé par\s*stripe|con tecnología de\s*stripe|stripe checkout/i, /(^|\.)stripe\.(com|network)$/],
        ['ЮKassa', /юkassa|yookassa|юmoney|yoomoney/i, /(^|\.)(yookassa|yoomoney)\.ru$/],
        ['CloudPayments', /cloudpayments/i, /(^|\.)cloudpayments\.ru$/],
        ['Т-Касса', /т-касс|tinkoff ?kassa/i, /(^|\.)(tbank|tinkoff)\.ru$/],
        ['PayPal', /powered by\s*paypal|paypal checkout/i, /(^|\.)paypal\.com$/]];
      const claim = ownCard && CLAIMS.find(([, said, host]) => said.test(ctx.text) && !host.test(ctx.host) &&
        !ctx.scripts.some((s) => s.host && host.test(s.host)));
      if (claim) {
        out.push({ severity: 'danger', title: 'Страница изображает окно оплаты ' + claim[0],
          details: ['На странице написано, что оплату проводит ' + claim[0] + ', но поля карты – обычные поля страницы, и номер получит ' + ctx.host + '. Кода ' + claim[0] + ' на странице нет.'],
          advice: 'Не вводите карту. Настоящее окно ' + claim[0] + ' открывается на адресе самого сервиса.' });
      } else if (ownCard) {
        const u = new URL(ownCard.el.form.getAttribute('action') || '', ctx.url);
        out.push({ severity: 'warning', title: 'Номер карты получит сам сайт, а не банк',
          details: ['Форма отправит номер карты на ' + addrOf(u) + '. Платёжного окна банка или платёжного сервиса на странице нет.'],
          advice: 'Не вводите карту, пока не убедитесь, что это сайт, который вы открыли сами.' });
      }
    }

    // Лишнее: то, что для оплаты картой не нужно никогда.
    const EXTRA = ['pin', 'mailPassword', 'bankPassword', 'ssn', 'maiden'];
    const extra = [...new Set(sens.filter((f) => EXTRA.includes(f.kind)).map((f) => ASK[f.kind]))];
    if (hasCard && extra.length) {
      out.push({ severity: 'danger', title: 'Вместе с картой просят ' + extra.join(', '),
        details: ['Для оплаты картой хватает номера, срока действия и CVV. Остальное нужно, чтобы от вашего имени пройти проверку банка.'],
        advice: 'Ничего не вводите.' });
    }
    // «Получите деньги»: для зачисления достаточно номера карты, CVV и срок нужны только для списания.
    const forReceive = ['cvv', 'expiry', 'balance'].filter((k) => ctx.has(k)).map((k) => ASK[k]);
    if (RECEIVE_WORDS.test(ctx.text) && forReceive.length) {
      const what = forReceive.length > 1 ? forReceive.slice(0, -1).join(', ') + ' и ' + forReceive[forReceive.length - 1] : forReceive[0];
      out.push({ severity: 'danger', title: 'Для получения денег просят ' + what,
        details: ['Чтобы перевести вам деньги, достаточно номера карты или телефона. Остальное нужно, чтобы списать деньги с карты.'],
        advice: 'Ничего не вводите и закройте страницу.' });
    }
    // Код из SMS: на странице входа в банк это нормально; опасно – когда его просят «для получения денег»,
    // «для отмены операции», вместе с картой или от имени курьера и «службы безопасности».
    const shown = (kind) => ctx.fields.some((f) => f.kind === kind && D.isRendered(f.el));
    if (shown('smsCode')) {
      const cancel = findAffirmed(ctx.text, /(?:отмен|cancel)[а-яёa-z]*\s+(?:\S+\s+){0,3}(?:операц|транзакц|списан|платеж|платёж|перевод|transaction|payment)/i);
      const why = cancel ? ['для «отмены операции»', 'Банк не отменяет операции по коду из SMS: этим кодом мошенник подтвердит списание.']
        : RECEIVE_WORDS.test(ctx.text) ? ['для «получения денег»', 'Код из SMS подтверждает списание, а не зачисление.']
          : /курьер|доставк|служба безопасности/i.test(ctx.role || '') ? ['не на странице банка', 'Страница представляется: ' + ctx.role + '. Код из SMS вводят только на странице своего банка и никому не сообщают.']
            : hasCard ? ['вместе с данными карты', 'Банк спрашивает код на своей отдельной странице, а не в форме магазина.'] : null;
      if (why) {
        out.push({ severity: 'danger', title: 'Просят код из SMS ' + why[0], details: [why[1]],
          advice: 'Не вводите код. Прочитайте само SMS: в нём написано, что именно подтверждает код.' });
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- 2. Кому уйдут деньги
  CHECKS['recipient'] = (ctx) => {
    const out = [];
    const r = ctx.recipient;
    const persons = r.items.filter((i) => i.kind === 'person' || i.kind === 'deposit');
    if (ctx.role && persons.length) {
      out.push({ severity: 'danger', title: 'Деньги уйдут частному лицу',
        details: ['Страница представляется: ' + ctx.role + ', а получатель – ' + persons.map((p) => p.text).join('; ') + '. Организации принимают оплату на счёт организации, а не на личную карту или телефон.'],
        advice: 'Не платите. Найдите реквизиты организации на её официальном сайте или в квитанции.' });
    }
    if (r.items.length && findAffirmed(ctx.text, /безопасн[а-яё\w]+ сч[её]т|резервн[а-яё\w]+ сч[её]т|защищ[её]нн[а-яё\w]+ сч[её]т/i)) {
      out.push({ severity: 'danger', title: 'Просят перевести деньги на «безопасный счёт»',
        details: ['Банки и Банк России не переводят деньги клиентов на «безопасные» или «резервные» счета.'],
        advice: 'Ничего не переводите. Положите трубку и позвоните в банк по номеру с обратной стороны карты.' });
    }
    // Просьба перевести деньги вручную на карту или по телефону вместо оплаты на сайте.
    const m = findAffirmed(ctx.text, /(переведите|перевести|отправьте|внесите|оплатите|оплата)[^.!?\n]{0,80}?(на (?:номер )?карт[а-яё\w]*|по номеру (?:карты|телефона)|на номер телефона|по телефону)/i);
    if (m && !out.length) {
      const boosters = [];
      if (/онлайн[- ]?оплат[а-яё]*[^.!?\n]{0,40}(не работает|недоступн|отключ|не принима)|оплат[а-яё]* только переводом/i.test(ctx.text)) boosters.push('«онлайн-оплата не работает»');
      if (/пришлите[^.!?\n]{0,20}(скриншот|чек|фото)/i.test(ctx.text)) boosters.push('просят прислать скриншот перевода');
      if (ctx.role) boosters.push('страница представляется: ' + ctx.role);
      out.push({ severity: boosters.length ? 'danger' : 'warning', title: 'Просят перевести деньги на карту или по номеру телефона',
        details: ['На странице: «' + m[0].trim().slice(0, 110) + '»' + (boosters.length ? '; ' + boosters.join('; ') : '') + '. Такой перевод вы подтверждаете сами, и банк его почти никогда не возвращает.'],
        advice: 'Платите только через платёжную форму сайта или по счёту организации.' });
    }
    for (const bad of r.items.filter((i) => i.invalid)) {
      out.push({ severity: 'warning', title: 'В реквизитах ошибка контрольной суммы', details: [bad.text + ': ' + bad.invalid + '.'],
        advice: 'Сверьте реквизиты с договором или квитанцией.' });
    }
    // QR-коды и ссылки СБП: то, чего человек не может прочитать сам.
    const pageSums = ctx.amounts;
    for (const q of ctx.qr.found) {
      const gost = R.parseGostQr(q.raw), sbp = R.parseSbpLink(q.raw);
      if (gost) {
        const nameWord = (gost.name || '').replace(/["«»]/g, '').split(/\s+/).find((w) => w.length > 3 && !/^(ООО|АО|ПАО|ИП)$/.test(w));
        if (nameWord && !ctx.text.toLowerCase().includes(nameWord.toLowerCase())) {
          out.push({ severity: 'warning', title: 'Получатель в QR-коде не тот, кто указан на странице',
            details: ['В коде получатель «' + gost.name + '», а на странице это имя не упоминается. Так выглядит QR-код, подклеенный поверх настоящего.'],
            advice: 'Не платите по этому коду. Найдите получателя в приложении банка по ИНН или названию.' });
        }
        if (gost.sum != null && pageSums.length && !pageSums.includes(gost.sum)) {
          out.push({ severity: 'warning', title: 'Сумма в QR-коде не совпадает с суммой на странице',
            details: ['В QR-коде ' + rub(gost.sum) + ', на странице ' + pageSums.map(rub).join(', ') + '.'], advice: 'Не платите по этому коду.' });
        }
      } else if (sbp && !sbp.official) {
        out.push({ severity: 'danger', title: 'QR-код «СБП» ведёт не в Систему быстрых платежей',
          details: ['Адрес в коде: ' + sbp.host + '. Настоящие коды СБП ведут только на qr.nspk.ru.'], advice: 'Не сканируйте и не платите.' });
      } else if (sbp && sbp.sum != null && pageSums.length && !pageSums.includes(sbp.sum)) {
        out.push({ severity: 'warning', title: 'Сумма в QR-коде не совпадает с суммой на странице',
          details: ['В QR-коде ' + rub(sbp.sum) + ', на странице ' + pageSums.map(rub).join(', ') + '.'], advice: 'Не платите по этому коду.' });
      }
    }
    const seen = new Set();
    for (const a of ctx.doc.querySelectorAll('a[href]')) {
      let abs = '';
      try { abs = new URL(a.getAttribute('href'), ctx.url).href; } catch (e) { continue; }
      const link = R.parseSbpLink(abs);
      if (!link || link.official || seen.has(link.host) || !/сбп|sbp|быстрых платеж/i.test(D.label(a) + ' ' + abs)) continue;
      seen.add(link.host);
      out.push({ severity: 'danger', title: 'Кнопка «' + D.label(a).slice(0, 30) + '» ведёт не в Систему быстрых платежей',
        details: ['Адрес ссылки: ' + link.host + '. Настоящие ссылки СБП ведут только на qr.nspk.ru и открывают приложение банка.'], advice: 'Не нажимайте эту кнопку.' });
    }
    // Ничего подозрительного: просто показываем, кому уйдут деньги.
    if (!out.length && r.items.length) {
      out.push({ severity: 'info', title: 'Кому уйдут деньги', details: [r.items.map((i) => i.text).join('; ') + '.'] });
    }
    return out;
  };

  // ---------------------------------------------------------------- 3. Сколько спишут
  CHECKS['charges'] = (ctx) => {
    const out = [];
    const totals = [];
    for (const m of ctx.text.matchAll(/(итого|к оплате|сумма заказа|всего|стоимость заказа)[^\d]{0,25}([\d  ]+(?:[.,]\d{1,2})?\s?(?:₽|руб))/gi)) totals.push(...amountsIn(m[2]));
    // Цена-приманка: «Премиум за 29 ₽», «доступ за 1 рубль» – самая маленькая сумма на странице (до 99 ₽).
    const teaser = !totals.length && ctx.amounts.length && Math.min(...ctx.amounts) <= 99 ? [Math.min(...ctx.amounts)] : [];
    const now = Math.max(...totals, ...teaser);
    for (const b of totals.length ? ctx.doc.querySelectorAll('button,input[type=submit],a[href]') : []) {
      const label = D.label(b);
      if (!PAY_WORDS.test(label)) continue;
      const more = amountsIn(label).filter((a) => !totals.includes(a) && a > Math.max(...totals));
      if (more.length) {
        out.push({ severity: 'warning', title: 'На кнопке оплаты сумма больше суммы заказа',
          details: ['Заказ: ' + totals.map(rub).join(', ') + ', на кнопке: «' + label + '».'], advice: 'Не нажимайте, пока не поймёте, за что берут разницу.' });
        break;
      }
    }
    for (const h of totals.length ? ctx.doc.querySelectorAll('form input[type=hidden]') : []) {
      if (!/amount|sum|сумм|total|price/i.test(h.name)) continue;
      const v = Number(String(h.value).replace(',', '.'));
      if (v && !totals.includes(v) && !totals.includes(v / 100)) {
        out.push({ severity: 'warning', title: 'Форма передаёт другую сумму, чем на экране',
          details: ['На экране ' + totals.map(rub).join(', ') + ', а в форме – ' + rub(v) + '.'], advice: 'Не подтверждайте оплату.' });
        break;
      }
    }
    // Подписка: на экране символическая сумма, а регулярные списания – мелким шрифтом, галочкой или скрытым полем.
    const SUBSCR = /подписк|автоплат[её]ж|автопродлен|автосписан|регулярн[а-яё]* (?:списан|плат)|рекуррент/i;
    const RECUR = /далее|затем|ежемесячн|в месяц|\/\s?мес|каждые\s+\d+|раз в\s+(?:\d+\s+)?(?:дн|недел|месяц)|после[^.!?\n]{0,40}(?:период|дн[яе]й)|по истечении[^.!?\n]{0,40}период|за неделю|в неделю|за \d+ дн[яе]й|автоматическ[а-яё]* списан|продлева|автопродлен/i;
    const deepest = (test) => [...ctx.doc.querySelectorAll('body *')].filter((el) => !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) &&
      el.textContent.length < 700 && test(el.textContent) && D.isRendered(el) && ![...el.children].some((c) => test(c.textContent)));
    const fontPx = (el) => parseFloat(ctx.win.getComputedStyle(el).fontSize) || 16;
    if ((totals.length || teaser.length) && RECUR.test(ctx.text)) {
      const lim = teaser.length ? now * 10 : now;
      const later = deepest((t) => RECUR.test(t) && amountsIn(t).some((a) => a > lim))[0];
      if (later) {
        const sums = amountsIn(later.textContent).filter((a) => a > lim);
        const shortPeriod = /за неделю|в неделю|еженедельн|за \d+ дн[яе]й|каждые \d+ дн/i.test(later.textContent);
        const small = fontPx(later) <= 11 || D.effectiveOpacity(later) < 0.6;
        const quote = '«' + later.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) + '»';
        if (small || (teaser.length && shortPeriod && Math.max(...sums) >= now * 20)) {
          out.push({ severity: 'warning', title: 'Сейчас ' + rub(now) + ', а дальше – ' + rub(Math.max(...sums)) + (shortPeriod ? ' каждую неделю' : ' регулярно'),
            details: ['Условие на странице: ' + quote + (small ? ', набрано шрифтом ' + Math.round(fontPx(later)) + ' px.' : '.')],
            advice: 'Если подписка не нужна – не платите. Для пробных оплат удобна отдельная карта с лимитом.' });
        } else {
          out.push({ severity: 'info', title: 'После первой оплаты будут регулярные списания', details: ['Условие: ' + quote + '.'] });
        }
      }
    }
    for (const box of ctx.doc.querySelectorAll('input[type=checkbox]')) {
      if (!box.defaultChecked) continue;
      const label = [...(box.labels || [])].map((l) => l.textContent).join(' ') || (box.parentElement ? box.parentElement.textContent : '');
      if (!SUBSCR.test(label) && !/платн[а-яё]+ (?:услуг|доступ|опци)|страхов/i.test(label)) continue;
      out.push({ severity: 'warning', title: 'Галочка согласия на платную услугу уже стоит',
        details: ['Отмечено заранее: «' + label.replace(/\s+/g, ' ').trim().slice(0, 120) + '».'], advice: 'Снимите галочку, если услуга не нужна.' });
      break;
    }
    // Скрытое поле автосписаний считается только в форме оплаты рядом с суммой: поле «subscribe» в форме рассылки – не подписка с оплатой.
    const flag = (totals.length || teaser.length) && [...ctx.doc.querySelectorAll('form input[type=hidden]')].find((h) => /recurr|rebill|auto_?pay|auto_?renew|subscri/i.test(h.name) &&
      !/news|mail|letter|рассыл/i.test(h.name) && !/^(|0|false|no|off)$/i.test(String(h.value).trim()) &&
      [...h.form.querySelectorAll('input')].some((f) => ['cardNumber', 'cvv'].includes(D.fieldKind(f))) );
    if (flag && !deepest((t) => SUBSCR.test(t)).some((el) => fontPx(el) >= 13)) {
      out.push({ severity: 'warning', title: 'Форма включает автоматические списания, о которых не сказано',
        details: ['В форме оплаты скрытое поле «' + flag.name + '»: подписка с регулярными списаниями. На странице о ней обычным шрифтом не написано.'],
        advice: 'Не платите, пока не найдёте условия подписки.' });
    }
    // Кнопка с безобидной надписью, которая на деле ведёт к оплате или подписке.
    const harmless = /бесплатн|получить|подарок|продолжить|закрыть|далее|проверить|посмотреть/i;
    const paying = /(?:^|[^a-z])(?:pay|checkout|subscribe|charge|purchase)(?![a-z])|оплат|подписк|списан/i;
    for (const el of ctx.doc.querySelectorAll('a[href],button,input[type=submit]')) {
      if (!D.isRendered(el)) continue;
      const visible = D.label(el);
      if (!harmless.test(visible) || paying.test(visible)) continue;
      const form = el.form || el.closest('form');
      const actual = [el.getAttribute('href'), el.getAttribute('formaction'), form && form.getAttribute('action'), el.dataset && el.dataset.action].filter(Boolean).join(' ');
      if (paying.test(actual)) {
        out.push({ severity: 'warning', title: 'Кнопка «' + visible.slice(0, 40) + '» оформляет оплату',
          details: ['Надпись безобидная, а кнопка ведёт на: ' + actual.slice(0, 100) + '.'], advice: 'Не нажимайте, пока не увидите цену и условия.' });
        break;
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- 4. Что делает код страницы
  CHECKS['page-code'] = (ctx) => {
    const out = [];
    const cardOnPage = ['cardNumber', 'cvv', 'expiry'].some((k) => ctx.has(k));
    // Главный признак скиммера – поведение: номер введённой карты уходит на посторонний сайт.
    const net = ctx.sensors.network || [];
    const foreign = (n) => n.host && D.siteOf(n.host) !== ctx.site && !isPsp(n.host) && !D.isLocalHost(n.host);
    const before = new Set(net.filter((n) => !n.afterCardInput && n.host).map((n) => n.host));
    const after = net.filter((n) => n.afterCardInput && foreign(n));
    const stolen = [...new Set(after.filter((n) => cardInPayload((n.url || '') + '\n' + (n.body || ''), ctx.sensors.cardDigits)).map((n) => n.host))];
    if (stolen.length) {
      out.push({ severity: 'danger', title: 'Номер карты отправлен на посторонний сайт: ' + stolen.join(', '),
        details: ['Сразу после ввода номер карты ушёл на ' + stolen.join(', ') + ' – это не магазин и не платёжный сервис. Так работает скиммер, внедрённый в страницу оплаты.'],
        advice: 'Не завершайте оплату. Если номер уже введён – заблокируйте карту в приложении банка.' });
    } else {
      const fresh = [...new Set(after.filter((n) => !before.has(n.host)).map((n) => n.host))];
      if (fresh.length) {
        out.push({ severity: 'warning', title: 'После ввода карты страница обратилась к новому сайту: ' + fresh.join(', '),
          details: ['До ввода карты страница с этим сайтом не работала. Номера карты в запросе не видно, но он мог быть зашифрован.'],
          advice: 'Не завершайте оплату на этой странице.' });
      }
    }
    // Скрытый загрузчик: скрипт прячет адрес (atob) или берёт его из блокчейна и сам вставляет в страницу чужой код.
    // Так подключают скиммер к взломанному магазину (paradisecoffee.ky, urlscan.io, 2026). Проверка идёт на любой странице.
    for (const s of ctx.scripts) {
      if (!s.code) continue;
      const inserts = /insertBefore|appendChild|import\s*\(/.test(s.code);
      if (!inserts) continue;
      const hidden = [...s.code.matchAll(/atob\(\s*['"]([A-Za-z0-9+/=]{16,})['"]\s*\)/g)].map((m) => { try { return atob(m[1]); } catch (e) { return ''; } });
      const url = hidden.map((h) => h.match(/^https?:\/\/([a-z0-9.-]+)\/\S*\.m?js\b/i)).find((u) => u && D.siteOf(u[1]) !== ctx.site && !isPsp(u[1]) && !/google|gstatic|yandex|cloudflare|jsdelivr|unpkg/i.test(u[1]));
      const chain = /JsonRpcProvider|eth_call/.test(s.code) && /\.Contract\s*\(|getText|eth_call/.test(s.code) && /createElement/.test(s.code);
      if (!url && !chain) continue;
      const disguise = /googletagmanager|GTM-|gtm\.js|dataLayer/i.test(s.code) ? ' под видом Google Tag Manager' : '';
      out.push({ severity: cardOnPage ? 'danger' : 'warning',
        title: chain ? 'Скрипт' + disguise + ' берёт адрес из блокчейна и подгружает чужой код' : 'Скрипт' + disguise + ' прячет адрес и подгружает код с ' + url[1],
        details: [chain ? 'Код обращается к смарт-контракту, получает из него зашифрованный адрес сервера и вставляет в страницу скрипт с этого адреса. Честным счётчикам и виджетам незачем прятать, откуда они загружаются.'
          : 'Адрес ' + url[0].slice(0, 80) + ' закодирован (atob), а скрипт сам вставляет его в страницу. Честным счётчикам и виджетам незачем прятать, откуда они загружаются.'],
        advice: cardOnPage ? 'Не вводите карту на этой странице.' : 'Если дальше будет оплата – не вводите карту на этом сайте.' });
      break;
    }
    // Запутанный код, который работает с полями карты и умеет отправлять данные (только на странице с картой).
    if (cardOnPage && !out.length) {
      const OBF = /eval\s*\(|new\s+Function\s*\(|String\.fromCharCode\((?:\s*\d+\s*,){8,}|(?:\\x[0-9a-f]{2}){12,}/i;
      const s = ctx.scripts.find((sc) => OBF.test(sc.code) && /(cc-?number|card.?num|cvv|cvc|cc-csc|cc-exp)/i.test(sc.code + revealHidden(sc.code)) &&
        /fetch\s*\(|XMLHttpRequest|sendBeacon|new\s+Image|WebSocket/.test(sc.code + revealHidden(sc.code)));
      if (s) {
        out.push({ severity: 'warning', title: 'Запутанный скрипт работает с полями карты',
          details: ['Скрипт «' + s.name + '» прячет свой код и при этом читает поля карты и умеет отправлять данные. Код честной формы оплаты незачем прятать.'],
          advice: 'Не вводите карту на этой странице.' });
      }
    }
    // Своя форма карты поверх окна платёжного сервиса.
    const cards = ctx.fields.filter((f) => f.kind === 'cardNumber').map((f) => f.el).filter(D.isRendered);
    for (const fr of ctx.doc.querySelectorAll('iframe')) {
      const host = D.hostOf(fr.src, ctx.url);
      if (!isPsp(host) || !D.isRendered(fr)) continue;
      if (cards.some((c) => overlap(rectOf(c), rectOf(fr)) > 0.3)) {
        out.push({ severity: 'danger', title: 'Поверх окна платёжного сервиса нарисована своя форма карты',
          details: ['Окно оплаты ' + host + ' закрыто полями самой страницы: номер карты получит не платёжный сервис, а тот, кто добавил форму.'],
          advice: 'Не вводите карту. Сообщите магазину.' });
        break;
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- 5. Давление и обещания
  CHECKS['pressure'] = (ctx) => {
    const out = [];
    // «Вас взломали» + номер телефона или Telegram: вход в схему «безопасный счёт».
    const SCARE = /вас взломали|ваш[а-я]* (?:аккаунт|кабинет|профиль|учётн[а-я]* запис[а-я]*) взлом|обнаружены подозрительные действия|обнаружена подозрительная активность|зафиксирован[а-я]* (?:попытк[а-я]* (?:взлома|входа|списани)|вход с неизвестного устройства)|доступ к учётной записи[^.!]{0,40}передан/i;
    const scareHead = [...ctx.doc.querySelectorAll('h1, h2, h3, strong, b, [class*=title], [class*=badge], [class*=alert]')]
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).find((t) => t.length < 120 && SCARE.test(t) && !/что делать|если|как |памятк|\?/i.test(t));
    const callTo = scareHead && ctx.text.match(/(?:позвоните|обратитесь|свяжитесь|звоните)[\s\S]{0,100}?((?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})/i);
    const tgLink = scareHead && !callTo && /сообщите|обратитесь|напишите|свяжитесь/i.test(ctx.text) &&
      [...ctx.doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => /^https?:\/\/(?:t\.me|telegram\.me)\//i.test(h));
    if (callTo || tgLink) {
      out.push({ severity: 'danger', title: callTo ? '«Вас взломали»: страница просит позвонить по номеру' : '«Вас взломали»: страница отправляет в Telegram',
        details: ['Заголовок: «' + scareHead.slice(0, 90) + '». ' + (callTo ? 'Номер: ' + callTo[1].replace(/\s+/g, ' ') : 'Ссылка: ' + tgLink.slice(0, 50)) +
          '. Там ответит «специалист», который уговорит перевести деньги или назвать коды.'],
        advice: 'Не звоните и не пишите. Проверьте вход сами в приложении Госуслуг или банка.' });
    }
    // Ложная техподдержка: «вирус» и номер «поддержки».
    const VIRUS = /(?:virus(?:es)?|threats?|trojan|spyware|malware) (?:detected|found|alert)|access to this pc has been blocked|(?:your )?(?:computer|pc|system|device) (?:has been |is )?(?:blocked|locked|infected|compromised|hacked)|вирус обнаружен|компьютер заблокирован|bedrohungen erkannt/i;
    if (!out.length && VIRUS.test(ctx.text) && !/\bscam\b|how to (?:remove|get rid)|мошенни|fake (?:alert|pop-?up|virus)|prank/i.test(ctx.text)) {
      const phone = ctx.text.match(/(?:call|contact|toll[ -]?free|helpline|support|позвоните|rufen sie)[\s\S]{0,80}?(\+?1?[\s(.-]*8\d{2}[\s).-]*\d{3}[\s.-]*\d{4}|\+\d{1,3}[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2,4}[\s.-]*\d{0,4})/i);
      if (phone) {
        out.push({ severity: 'danger', title: 'Поддельное предупреждение о вирусе с номером «поддержки»',
          details: ['На странице: «' + ctx.text.match(VIRUS)[0] + '» и номер ' + phone[1].trim() + '. Windows и антивирусы не показывают номер телефона в предупреждениях.'],
          advice: 'Не звоните и ничего не устанавливайте. Закройте вкладку или браузер целиком.' });
      }
    }
    // Программа удалённого доступа «для защиты счёта».
    const rat = ctx.text.match(/anydesk|rustdesk|teamviewer|rudesktop|airdroid|ammyy|quick ?support/i);
    if (rat && /(установите|скачайте|запустите|продиктуйте|сообщите)/i.test(ctx.text) && /(банк|служб[а-яё]* безопасности|защит|госуслуг|счёт|счет)/i.test(ctx.text)) {
      out.push({ severity: 'danger', title: 'Просят установить ' + rat[0],
        details: ['Через программу удалённого доступа мошенник видит экран и сам подтверждает переводы в вашем банковском приложении.'],
        advice: 'Ничего не устанавливайте. Банки никогда не просят ставить такие программы.' });
    }
    // Долг или штраф с угрозой пени и кнопкой оплаты прямо на странице.
    const DEBT = /outstanding (?:toll|balance|amount|invoice)|unpaid (?:toll|fine|invoice|parking|ticket)|toll (?:amount|balance) due|неоплаченн[а-яё]* (?:штраф|проезд|задолженн|налог)|задолженност[а-яё]* по (?:налогу|штрафу|оплате проезда)/i;
    const THREAT = /late fee|penalt|surcharge|collections?\b|suspen|(?:будет|будут) (?:удвоен|увеличен|передан)|удваива|пени\b|запрет на выезд|арест/i;
    const PAYBTN = [...ctx.doc.querySelectorAll('button, a, input[type=submit], input[type=button]')]
      .map((el) => (el.textContent || el.value || '').replace(/\s+/g, ' ').trim()).find((t) => t.length < 40 && /pay|оплат|proceed to payment/i.test(t));
    const debt = ctx.text.match(DEBT);
    if (debt && THREAT.test(ctx.text) && PAYBTN && /[$€£₽₸]\s?\d|\d[\d\s.,]*\s?(?:[$€£₽₸]|руб|eur|usd)/i.test(ctx.text) && !/\bscam\b|мошенни|phishing|фишинг/i.test(ctx.text)) {
      out.push({ severity: 'warning', title: 'Требуют срочно оплатить долг или штраф по ссылке',
        details: ['На странице: «' + debt[0] + '», угроза пени и кнопка «' + PAYBTN + '». Так выглядят рассылки о «неоплаченном проезде» и «штрафе».'],
        advice: 'Не платите по ссылке. Проверьте начисления сами – на Госуслугах или сайте оператора.' });
    }
    // Обещание конкретного дохода за день или месяц.
    if (!/\bscam\b|мошенни|\breview\b|отзыв|обзор/i.test(ctx.text.slice(0, 3000))) {
      const MONEY = '(?:[$€£₽₸]\\s?\\d[\\d\\s.,]{1,9}|\\d[\\d\\s.,]{1,9}\\s?(?:[$€£₽₸]|руб|тыс|zł|eur|usd|dollars?|euros?|долл))';
      const PER = '(?:в (?:день|сутки|неделю|месяц)|ежедневно|ежемесячно|per (?:day|week|month)|a (?:day|week|month)|daily|weekly|monthly|täglich|pro (?:tag|monat)|im monat|monatlich|dziennie|miesięcznie|par jour|par mois|al (?:día|mes)|al giorno|al mese)';
      const t = ctx.text;
      const promise = t.match(new RegExp('(?:доход|заработ|зарабатыва|получа|earn|make|profit|income|verdien|zarabia|gagne|guadagn|ganar)[^.!?]{0,60}?' + MONEY + '[^.!?]{0,25}?' + PER, 'i')) ||
        t.match(new RegExp(MONEY + '[^.!?]{0,25}?' + PER + '[^.!?]{0,40}?(?:доход|прибыл|profit|income|gewinn)', 'i')) ||
        t.match(/гарантированн[а-яё]* (?:доход|прибыл)|guaranteed (?:profit|return|income)|garantierte[nr]? (?:gewinn|rendite)|risk-free (?:profit|return)/i);
      if (promise) {
        const phone = [...ctx.doc.querySelectorAll('input')].some((el) => (el.type || '').toLowerCase() === 'tel' ||
          /phone|tel\b|телефон|telefon|téléphone|mobile/i.test([el.name, el.id, el.placeholder].join(' ')));
        out.push({ severity: phone ? 'warning' : 'info', title: phone ? 'Обещают доход и просят телефон' : 'Обещают конкретный доход',
          details: ['На странице: «' + promise[0].replace(/\s+/g, ' ').slice(0, 110) + '». Честные брокеры и банки не обещают сумму дохода.' + (phone ? ' После заявки звонит «менеджер» и уговаривает пополнить счёт.' : '')],
          advice: 'Не оставляйте телефон. Проверьте компанию в справочнике Банка России cbr.ru/fmp_check.' });
      }
    }
    // Таймеры и «только сегодня» рядом с оплатой.
    if (ctx.paymentContext) {
      const P = [/срочно/i, /немедленно/i, /только сегодня/i, /осталось\s+\d+\s*(?:мин|час|сек)/i, /в течение\s+\d+\s*(?:мин|час)/i,
        /иначе[^.]{0,40}(отмен|заблок|сгор|аннулир|спиш)/i, /последний шанс/i, /(бронь|заказ|ссылка)[^.]{0,20}истека/i];
      const hits = P.map((re) => ctx.text.match(re)).filter(Boolean);
      if (hits.length >= 2) {
        out.push({ severity: 'warning', title: 'Вас торопят',
          details: ['На странице: «' + hits.slice(0, 3).map((h) => h[0]).join('», «') + '». Спешка мешает проверить, кому вы платите.'],
          advice: 'Не торопитесь: на проверку адреса сайта и получателя нужна минута.' });
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- 6. Просят запустить команду (ClickFix)
  CHECKS['clickfix'] = (ctx) => {
    const docs = [ctx.doc];
    for (const fr of ctx.doc.querySelectorAll('iframe')) {
      try { if (fr.contentDocument && fr.contentDocument.body) docs.push(fr.contentDocument); } catch (e) { /* чужое окно недоступно */ }
    }
    // Инструкцию ищем во всём тексте, в том числе скрытом: шаги появляются только после нажатия на «капчу».
    const allText = (d) => {
      const out = [], walk = d.createTreeWalker(d.body, 4);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentNode.nodeName)) out.push(n.nodeValue);
      }
      return out.join(' ').replace(/\s+/g, ' ');
    };
    const text = docs.map(allText).join('\n');
    const codes = ctx.scripts.map((s) => s.code).concat(docs.slice(1).flatMap((d) => [...d.querySelectorAll('script:not([src])')].map((s) => s.textContent)));
    const OPEN = /(?:win(?:dows)?(?:\s*key)?\s*\+\s*[rx]\b|⊞\s*\+\s*[rx]\b|(?:^|\s)\+\s*[rx]\b|окно\s*«?выполнить»?|run dialog|windows powershell|терминал|terminal)/i;
    let instr = null;
    for (const m of text.matchAll(new RegExp(OPEN.source, 'gi'))) {
      const tail = text.slice(m.index, m.index + 400);
      if (/ctrl\s*\+\s*v|вставьте|paste/i.test(tail) && /enter|ввод/i.test(tail)) { instr = tail.slice(0, (tail.search(/enter|ввод/i) || 140) + 5); break; }
    }
    const clipWrite = codes.some((c) => /clipboard\.writeText|execCommand\(\s*['"]copy/.test(c + revealHidden(c)));
    const VERIFY = /not a robot|не робот|verify (?:that )?you(?:'re| are)|human verification|captcha|капч|cloudflare|verification (?:step|id|code)|подтвердите,? что вы/i;
    if (instr && !clipWrite && !VERIFY.test(text)) instr = null; // честная инструкция по Windows, не «проверка»
    const command = codes.some((c) => /powershell|mshta|cmd(?:\.exe)?\s*\/c|iwr\s|invoke-webrequest|curl\s|bitsadmin|rundll32|msiexec/i.test(c + revealHidden(c)) &&
      /clipboard\.writeText|execCommand\(\s*['"]copy/.test(c + revealHidden(c)));
    if (instr || command) {
      const hiddenNow = instr && !ctx.text.replace(/\s+/g, ' ').includes(instr.replace(/\s+/g, ' ').trim().slice(0, 15));
      return [{ severity: 'danger', title: 'Поддельная проверка «я не робот» просит запустить команду',
        details: [(instr ? 'Инструкция: «' + instr.replace(/\s+/g, ' ').trim().slice(0, 140) + '»' + (hiddenNow ? ' – появится после нажатия на «проверку»' : '') + '. ' : '') +
          (command || clipWrite ? 'Скрипт страницы кладёт в буфер обмена команду, которая скачает и запустит вредоносную программу. ' : '') +
          'Настоящая капча не просит открывать «Выполнить», PowerShell или терминал.'],
        advice: 'Ничего не нажимайте и не вставляйте. Если команду уже запустили – отключите интернет и смените пароли с другого устройства.' }];
    }
    // Первый шаг: флажок «я не робот» нарисован самой страницей, кода настоящей службы проверки нет.
    const PHRASE = /i'?m not a robot|i am not a robot|verify (?:that )?you are (?:a )?human|я не робот|checking if you are human|je ne suis pas un robot/i;
    const PROVIDER = /challenges\.cloudflare\.com|google\.com\/recaptcha|recaptcha\.net|gstatic\.com\/recaptcha|hcaptcha\.com|smartcaptcha|captcha-api\.yandex|arkoselabs|funcaptcha|geetest/i;
    const drawn = docs.some((d) => [...d.querySelectorAll('label, span, div, p, button, h1, h2')].some((el) =>
      el.children.length <= 2 && el.textContent.length < 80 && PHRASE.test(el.textContent)));
    const provider = docs.some((d) => [...d.querySelectorAll('script[src], iframe[src]')].some((el) => PROVIDER.test(el.getAttribute('src'))));
    if (!drawn || provider) return [];
    return [{ severity: 'warning', title: 'Проверка «я не робот» нарисована самой страницей',
      details: ['Флажок есть, а кода настоящей службы проверки (Cloudflare, reCAPTCHA, hCaptcha, Яндекс) нет. Так начинается ClickFix: после нажатия попросят нажать Win+R и вставить команду.'],
      advice: 'Не выполняйте никаких шагов с клавиатурой.' }];
  };

  // ---------------------------------------------------------------- 7. Криптокошелёк
  CHECKS['crypto-wallet'] = (ctx) => {
    const t = ctx.text;
    // Голая кнопка «Connect» считается кнопкой кошелька, только если на странице вообще говорится о кошельке или токенах.
    const crypto = /wallet|кошел[её]к|metamask|token|токен|airdrop|blockchain|блокчейн|nft|web3|defi|staking|\$[A-Z]{2,6}\b/.test(t) || /wallet|кошел[её]к|metamask|airdrop|blockchain|блокчейн|web3|staking/i.test(t);
    const connect = /connect\s+(?:your\s+)?wallet|подключ[а-яё]*\s+кошел[её]к|wallet\s?connect|connect\s+metamask/i.test(t) ||
      (crypto && [...ctx.doc.querySelectorAll('button, a')].some((el) => /^\s*(?:connect|подключить)\s*$/i.test(el.textContent || '')));
    const lure = t.match(/\bclaim(?:ing)?\b(?:\s+(?:your|now|tokens?|rewards?|airdrop|allocation))?|\bairdrop|token\s+distribution|rewards?\s+(?:allocation|proposal|date|distribution)|\beligib|получите\s+токены|раздач[а-яё]*\s+токенов|free\s+mint|бесплатн[а-яё]*\s+(?:токен|nft)/i);
    if (!connect || !lure) return [];
    const codes = ctx.scripts.map((s) => s.code + revealHidden(s.code)).join('\n');
    const drain = codes.match(/setApprovalForAll|increaseAllowance|\bpermit\s*\(|eth_signTypedData(?:_v4)?|signTypedData|Permit2|seaport|transferFrom\s*\(/);
    return [{ severity: drain ? 'danger' : 'warning',
      title: drain ? 'Сайт готовит подпись, которая разрешит списать ваши токены' : 'Раздача токенов с подключением кошелька',
      details: ['На странице: «' + lure[0] + '» и кнопка подключения кошелька.' + (drain ? ' В коде – запрос «' + drain[0].replace(/\s*\($/, '') + '»: такая подпись разрешает сайту забрать токены.' : ' Так выглядят копии криптопроектов, где вместо получения токенов подпись разрешает их списание.')],
      advice: 'Не подключайте кошелёк. Найдите раздачу в официальном аккаунте проекта и откройте сайт оттуда.' }];
  };

  // =====================================================================
  //  Сборка отчёта
  // =====================================================================
  function describeRecipient(text, qrFound) {
    const req = R.findRequisites(text);
    const items = [];
    for (const c of req.cards) {
      if (!R.nearPayment(text, c.at) || /test|тестов/i.test(text.slice(Math.max(0, c.at - 200), c.at))) continue; // номер в инструкции или примере – не реквизит
      items.push({ kind: 'person', text: 'карта ' + c.system + ' ' + c.masked + ' (личная карта)' });
    }
    for (const p of req.phones) {
      if (!R.nearPayment(text, p.at)) continue; // контактный телефон, а не реквизит для перевода
      items.push({ kind: 'person', text: 'перевод по телефону ' + p.masked + ' (через СБП – человеку)' });
    }
    for (const a of req.accounts) {
      const key = req.bic ? R.accountKeyValid(a.value, req.bic) : null;
      items.push({ kind: a.type.kind, text: 'счёт ' + a.masked + ' – ' + a.type.label, invalid: key === false ? 'контрольный ключ счёта не сходится с БИК ' + req.bic : null });
    }
    if (req.inn && !R.innValid(req.inn)) items.push({ kind: 'unknown', text: 'ИНН ' + req.inn, invalid: 'неверные контрольные цифры ИНН' });
    for (const q of qrFound) {
      const g = R.parseGostQr(q.raw);
      if (g && g.account) {
        const t = R.accountType(g.account);
        const key = g.bic ? R.accountKeyValid(g.account, g.bic) : null;
        items.push({ kind: t.kind, text: 'счёт из QR-кода ' + R.mask(g.account) + ' – ' + t.label + (g.name ? ', получатель: ' + g.name : ''), invalid: key === false ? 'контрольный ключ счёта не сходится с БИК ' + g.bic : null });
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
    // Платёжный объект – то, что реально ведёт к деньгам: поле карты, реквизиты или платёжный QR.
    // Одних слов («перевести», «pay») мало: на обычных страницах они встречаются постоянно.
    const paymentQr = qr.found.some((q) => R.parseGostQr(q.raw) || R.parseSbpLink(q.raw));
    const sbpLink = !!doc.querySelector('a[href*="qr.nspk.ru"]');
    ctx.paymentObject = ctx.has('cardNumber') || ctx.recipient.items.length > 0 || paymentQr || sbpLink;
    ctx.paymentContext = ctx.paymentObject || (PAY_WORDS.test(text) && ctx.amounts.length > 0);

    const findings = [];
    for (const [id, check] of Object.entries(CHECKS)) {
      try {
        // К предупреждению добавляется совет – что человеку сделать прямо сейчас.
        for (const f of check(ctx)) findings.push(Object.assign({ check: id }, f));
      } catch (e) {
        findings.push({ check: id, severity: 'error', title: 'Проверка завершилась с ошибкой', details: [String(e && e.message || e)] });
      }
    }
    // В панели везде короткое тире: и в наших текстах, и в цитатах со страницы («Бронь истекает — иначе…»).
    const dash = (t) => (typeof t === 'string' ? t.replace(/—/g, '–') : t);
    for (const f of findings) { f.title = dash(f.title); f.advice = dash(f.advice); if (f.details) f.details = f.details.map(dash); }
    if (ctx.recipient && ctx.recipient.items) for (const i of ctx.recipient.items) i.text = dash(i.text);
    const order = { danger: 0, warning: 1, info: 2, error: 3 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);

    const limits = [];
    if (qr.unreadable.length) limits.push('Не удалось прочитать картинки с другого сайта – QR-коды на них не проверены.');
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
    danger: { title: 'Высокий риск', tone: 'danger' },
    warning: { title: 'Есть подозрительные признаки', tone: 'warning' },
    ok: { title: 'Явных признаков обмана не найдено', tone: 'ok' },
    none: { title: 'Платёжных действий не найдено', tone: 'none' },
  };

  root.PGChecks = { inspect, CHECK_IDS: Object.keys(CHECKS), VERDICTS, amountsIn };
})(typeof window !== 'undefined' ? window : globalThis);
