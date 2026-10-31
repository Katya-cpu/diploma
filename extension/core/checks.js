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

  const PAY_WORDS = /оплат|перевед|перевест|перевод|к оплате|купить|pay|checkout/i;
  const RECEIVE_WORDS = /(получ[а-яё\w]*|зачисл[а-яё\w]*|принять|вывести|вывод)\s+(?:\S+\s+){0,3}(деньг|оплат|выплат|средств|перевод|компенсац)/i;

  function amountsIn(text) {
    const out = [];
    for (const m of String(text).matchAll(/(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?(?:₽|руб)/gi)) {
      out.push(Number(m[1].replace(/\D/g, '') + '.' + (m[2] || '0')));
    }
    return [...new Set(out)];
  }
  const rub = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';

  function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)) : 0;
  }

  // ---------- Сбор скриптов страницы (встроенные + файлы того же сайта или любого в расширении) ----------
  async function collectScripts(doc, allowFetch) {
    const list = [];
    for (const s of doc.querySelectorAll('script')) {
      const src = s.getAttribute('src');
      if (!src) { list.push({ name: 'встроенный скрипт', host: doc.location.hostname, code: s.textContent.slice(0, 200000) }); continue; }
      const url = new URL(src, doc.location.href);
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
    for (const f of cards) {
      const form = f.el.form;
      const action = form && form.getAttribute('action');
      if (!action) continue;
      const u = new URL(action, ctx.url);
      if (u.protocol === 'http:' && !D.isLocalHost(u.hostname)) {
        out.push({ severity: 'danger', title: 'Данные карты будут отправлены без шифрования', details: ['Адрес отправки формы: ' + u.protocol + '//' + u.hostname] });
      } else if (D.siteOf(u.hostname) !== ctx.site && !isPsp(u.hostname)) {
        out.push({ severity: 'warning', title: 'Данные карты уходят на другой сайт', details: ['Страница: ' + ctx.host + ', а форма отправляется на ' + u.hostname + ' — это не известный платёжный провайдер.'] });
      }
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
    const asked = [];
    if (ctx.has('smsCode')) asked.push('код из SMS');
    if (ctx.has('bankPassword')) asked.push('пароль/кодовое слово/PIN');
    const textAsk = /(сообщите|назовите|продиктуйте|отправьте|введите)\s+(?:\S+\s+){0,3}(код из (?:смс|sms)|код подтверждения|пароль от)/i.test(ctx.text);
    if (!asked.length && !textAsk) return [];
    const risky = RECEIVE_WORDS.test(ctx.text) || /служба безопасности|доставк|курьер/.test(ctx.role || '');
    return [{ severity: risky || ctx.has('bankPassword') ? 'danger' : 'warning',
      title: 'Страница просит секретный код или пароль от банка',
      details: ['Запрашивается: ' + (asked.join(', ') || 'код подтверждения (в тексте)') + '.',
        'Код из SMS подтверждает списание денег. Его вводят только на странице подтверждения вашего банка (3-D Secure) и никогда не сообщают магазину, курьеру или «службе безопасности».'] }];
  };

  // 4. Просьба перевести деньги вручную (APP-мошенничество)
  CHECKS['manual-transfer'] = (ctx) => {
    const m = ctx.text.match(/(переведите|перевести|отправьте|внесите|оплатите|оплата)[^.!?\n]{0,80}?(на (?:номер )?карт[а-яё\w]*|по номеру (?:карты|телефона)|на номер телефона|по телефону|на (?:указанный |этот |следующий )?сч[её]т|через сбп)/i);
    if (!m) return [];
    const items = ctx.recipient.items;
    if (items.length && items.every((i) => ['company', 'entrepreneur', 'treasury'].includes(i.kind))) {
      return [{ severity: 'info', title: 'Оплата по реквизитам организации',
        details: ['Фраза на странице: «' + m[0].trim().slice(0, 120) + '». Деньги уходят на счёт организации — это обычная практика для счетов и квитанций. Сверьте название и ИНН с договором.'] }];
    }
    return [{ severity: 'warning', title: 'Предлагают перевести деньги вручную, а не оплатить на сайте',
      details: ['Фраза на странице: «' + m[0].trim().slice(0, 120) + '».',
        'Такой перевод вы подтверждаете сами, поэтому вернуть деньги через банк почти невозможно. Магазины и службы доставки принимают оплату через платёжную форму, а не переводом на карту.'] }];
  };

  // 5. Кому уйдут деньги: согласованность реквизитов с тем, кем представляется страница
  CHECKS['recipient'] = (ctx) => {
    const out = [];
    const r = ctx.recipient;
    if (!r.items.length) return [];
    const persons = r.items.filter((i) => i.kind === 'person' || i.kind === 'deposit');
    if (ctx.role && persons.length) {
      out.push({ severity: 'danger', title: 'Страница от имени организации просит перевести деньги частному лицу',
        details: ['Страница представляется как: ' + ctx.role + '.',
          'Но деньги уйдут: ' + persons.map((p) => p.text).join('; ') + '.',
          'Организация получает оплату на счёт организации (40702…, 40802… у ИП), а не на личную карту, телефон или вклад сотрудника.'] });
    }
    if (/безопасн[а-яё\w]+ сч[её]т|резервн[а-яё\w]+ сч[её]т|защищ[её]нн[а-яё\w]+ сч[её]т/i.test(ctx.text)) {
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
    return out;
  };

  // 7. Разные суммы в одном заказе (скрытые платежи)
  CHECKS['amount-mismatch'] = (ctx) => {
    const totals = [];
    for (const m of ctx.text.matchAll(/(итого|к оплате|сумма заказа|всего|стоимость заказа)[^\d]{0,25}([\d  ]+(?:[.,]\d{1,2})?\s?(?:₽|руб))/gi)) totals.push(...amountsIn(m[2]));
    if (!totals.length) return [];
    const out = [];
    for (const b of ctx.doc.querySelectorAll('button,input[type=submit],a[href]')) {
      const label = D.label(b);
      if (!PAY_WORDS.test(label)) continue;
      const onButton = amountsIn(label).filter((a) => !totals.includes(a));
      if (onButton.length) out.push({ severity: 'warning', title: 'Сумма на кнопке оплаты больше суммы заказа', details: ['Заказ: ' + totals.map(rub).join(', ') + ', кнопка «' + label + '».'] });
    }
    for (const h of ctx.doc.querySelectorAll('form input[type=hidden]')) {
      if (!/amount|sum|сумм|total|price/i.test(h.name)) continue;
      const v = Number(String(h.value).replace(',', '.'));
      if (v && !totals.includes(v) && !totals.includes(v / 100)) {
        out.push({ severity: 'warning', title: 'Форма скрыто передаёт другую сумму', details: ['На экране: ' + totals.map(rub).join(', ') + ', а в скрытом поле «' + h.name + '» — ' + rub(v) + '.'] });
      }
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

  // 9. Невидимый элемент поверх кнопки (кликджекинг)
  CHECKS['clickjacking'] = (ctx) => {
    const out = [];
    const all = [...ctx.doc.querySelectorAll(D.CLICKABLE)].filter(D.isRendered);
    const invisible = all.filter((el) => D.effectiveOpacity(el) < 0.1 && ctx.win.getComputedStyle(el).pointerEvents !== 'none');
    const visible = all.filter((el) => D.effectiveOpacity(el) > 0.5);
    const vw = ctx.win.innerWidth * ctx.win.innerHeight;
    for (const inv of invisible) {
      const r = rectOf(inv);
      if (r.w * r.h < 400) continue;
      const covered = visible.filter((v) => v !== inv && !inv.contains(v) && !v.contains(inv) && overlap(rectOf(v), r) > 0.5);
      const huge = (r.w * r.h) / vw > 0.3;
      if (!covered.length && !huge) continue;
      const target = [inv.getAttribute('href'), inv.getAttribute('src'), inv.getAttribute('action'), D.label(inv)].filter(Boolean).join(' ');
      out.push({ severity: inv.tagName === 'IFRAME' || PAY_WORDS.test(target) ? 'danger' : 'warning',
        title: 'Поверх кнопки лежит невидимый элемент',
        details: [(covered.length ? 'Вы видите «' + D.label(covered[0]) + '», ' : 'Невидимый слой закрывает большую часть экрана, ') +
          'но нажатие получит прозрачный ' + inv.tagName.toLowerCase() + (target ? ' (' + target.slice(0, 100) + ')' : '') + '.'] });
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
    if (ctx.sensors.addedCardFields > 0) {
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
    for (const s of ctx.scripts) {
      const tricks = OBF.filter(([re]) => re.test(s.code)).map(([, n]) => n);
      if (tricks.length) {
        out.push({ severity: 'warning', title: 'Запутанный (обфусцированный) код на странице оплаты',
          details: ['Скрипт «' + s.name + '» прячет свой смысл: ' + tricks.join(', ') + '. Честному коду формы оплаты незачем скрываться.'] });
      }
    }
    return out;
  };

  // 12. Скиммер: код читает поля карты и отправляет их на чужой адрес
  CHECKS['skimmer'] = (ctx) => {
    const out = [];
    for (const s of ctx.scripts) {
      const code = s.code + revealHidden(s.code);
      const readsCard = /(cc-?number|card.?num|cardnumber|cvv|cvc|cc-csc|cc-exp|autocomplete[^;\n]{0,30}cc-)/i.test(code) &&
        /(\.value\b|addEventListener\(\s*['"](?:input|change|blur|keyup|keydown|submit)|onsubmit|new\s+FormData)/.test(code);
      const sink = code.match(/fetch\s*\(|XMLHttpRequest|sendBeacon|new\s+Image|WebSocket/);
      if (!readsCard || !sink) continue;
      const urls = [...code.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase())
        .filter((h) => D.siteOf(h) !== ctx.site && !isPsp(h));
      out.push({ severity: urls.length ? 'danger' : 'warning', title: 'Скрипт читает поля карты и умеет отправлять данные',
        details: ['Скрипт «' + s.name + '» обращается к полям карты и использует ' + sink[0].replace(/\s*\($/, '') + '.' +
          (urls.length ? ' В коде найден посторонний адрес: ' + [...new Set(urls)].join(', ') + '.' : ' Адрес отправки в коде не найден.')] });
    }
    const leaks = ctx.sensors.network.filter((n) => n.afterCardInput && n.host && D.siteOf(n.host) !== ctx.site && !isPsp(n.host));
    if (leaks.length) {
      const hosts = [...new Set(leaks.map((l) => l.host + ' (' + l.how + ')'))];
      out.push({ severity: 'danger', title: 'После ввода карты страница отправила данные на посторонний сайт',
        details: ['Зафиксированы запросы: ' + hosts.join(', ') + '. Так веб-скиммер (Magecart) крадёт данные карты.'] });
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

  // =====================================================================
  //  Сборка отчёта
  // =====================================================================
  function describeRecipient(text, qrFound) {
    const req = R.findRequisites(text);
    const items = [];
    for (const c of req.cards) items.push({ kind: 'person', text: 'карта ' + c.system + ' ' + c.masked + ' (личная карта человека)' });
    for (const p of req.phones) items.push({ kind: 'person', text: 'перевод по телефону ' + p.masked + ' (через СБП — человеку)' });
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
    sensors = Object.assign({ changes: [], addedCardFields: 0, network: [], cardInputAt: null }, sensors || {});
    options = Object.assign({ fetchScripts: true, readQr: true }, options || {});
    const win = doc.defaultView;
    const text = ((doc.title || '') + '\n' + (doc.body ? doc.body.innerText : '')).slice(0, 40000);
    const fields = [...doc.querySelectorAll('input,textarea')].map((el) => ({ el, kind: D.fieldKind(el) })).filter((f) => f.kind);
    const qr = options.readQr && root.PGQr ? await root.PGQr.decodeAll(doc) : { found: [], unreadable: [] };
    const ctx = {
      doc, win, text, fields, qr, sensors,
      url: doc.location.href, host: doc.location.hostname, protocol: doc.location.protocol,
      site: D.siteOf(doc.location.hostname), isLocal: D.isLocalHost(doc.location.hostname),
      has: (kind) => fields.some((f) => f.kind === kind),
      scripts: await collectScripts(doc, options.fetchScripts),
      amounts: amountsIn(text),
      role: R.pageRole(text),
    };
    ctx.recipient = describeRecipient(text, qr.found);
    ctx.paymentContext = ctx.has('cardNumber') || ctx.recipient.items.length > 0 || qr.found.length > 0 || PAY_WORDS.test(text);

    const findings = [];
    for (const [id, check] of Object.entries(CHECKS)) {
      try {
        for (const f of check(ctx)) findings.push(Object.assign({ check: id }, f));
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
      : ctx.paymentContext ? 'ok' : 'none';
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

  root.PGChecks = { inspect, CHECK_IDS: Object.keys(CHECKS), VERDICTS, amountsIn };
})(typeof window !== 'undefined' ? window : globalThis);
