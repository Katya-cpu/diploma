/*
 * Вспомогательные функции для разбора страницы: какие поля чего просят,
 * что видно пользователю, какой домен у адреса. Значения полей никогда не читаются.
 */
(function (root) {
  'use strict';

  // Описание поля так, как его видит пользователь и разработчик формы.
  function fieldDescription(el) {
    const parts = [el.name, el.id, el.placeholder, el.autocomplete, el.getAttribute('aria-label')];
    try { for (const l of el.labels || []) parts.push(l.textContent); } catch (e) { /* нет меток */ }
    const prev = el.previousElementSibling;
    if (prev && /^(LABEL|SPAN|DIV|P)$/.test(prev.tagName)) parts.push(prev.textContent);
    // Форма-таблица (так свёрстаны многие фишинговые наборы): подпись стоит в соседней ячейке слева.
    const cell = el.closest && el.closest('td');
    const left = cell && cell.previousElementSibling;
    if (left && left.tagName === 'TD' && !left.querySelector('input,select,textarea')) parts.push(left.textContent);
    return parts.filter(Boolean).join(' ').toLowerCase().slice(0, 300);
  }

  // Тип поля по атрибутам autocomplete (стандарт HTML) и подписям на русском и английском.
  const FIELD_KINDS = [
    // Кроме стандартных имён – то, что встречается в настоящих фишинговых наборах (набор Zenodo 14880589):
    // имена ccnum/ccnumber, подписи на других языках и подсказка-образец номера «0000 0000 0000 0000».
    ['cardNumber', /cc-number|card.?num|cardnumber|\bcc.?num|номер карты|номер банковской карты|pan\b|nomor kartu|kartu debit|numéro de (?:la )?carte|kartennummer|número de (?:la )?tarjeta|numero (?:di |della )?carta|kart numaras|(?:\d{4}|0000|x{4})[ -](?:\d{4}|0000|x{4})[ -](?:\d{4}|0000|x{4})[ -](?:\d{4}|0000|x{4})/],
    ['cvv', /cc-csc|cvv|\bcvc|\bcsc|cvc2|код безопасности|трёхзначный код|3 цифры на обороте/],
    ['expiry', /cc-exp|\bccexp|expir|срок действия|мм\s*\/\s*гг|mm\s*\/\s*yy/],
    ['holder', /cc-name|cardholder|имя владельца|держател/],
    ['smsCode', /код из (?:смс|sms)|sms.?code|одноразов|код подтвержден|otp/],
    ['bankPassword', /пароль от (?:интернет|онлайн|мобильн).{0,10}банк|кодовое слово|pin-?код|пин-?код/],
    ['balance', /баланс|остаток на карте|остаток средств/],
    // Данные, которые для оплаты картой не нужны никогда (проверка «форма карты», признак «лишние данные»).
    ['ssn', /ssn|social.?security|снилс/],
    ['maiden', /maiden|девичь[а-яё]* фамили/],
    ['pin', /atm.?pin|card.?pin|pin(?![-_ ]?code)/],
    ['mailPassword', /e-?mail.?pass|password.{0,12}e-?mail|пароль от (?:почты|e-?mail|электронной почты)/],
  ];

  function fieldKind(el) {
    if (!el || el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return null;
    if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes((el.type || '').toLowerCase())) return null;
    const d = fieldDescription(el);
    for (const [kind, re] of FIELD_KINDS) if (re.test(d)) return kind;
    return null;
  }

  const isCardField = (el) => ['cardNumber', 'cvv', 'expiry', 'holder'].includes(fieldKind(el));

  function isRendered(el) {
    const win = el.ownerDocument.defaultView;
    const st = win.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Итоговая непрозрачность с учётом всех родителей (opacity перемножается).
  function effectiveOpacity(el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      o *= Number(n.ownerDocument.defaultView.getComputedStyle(n).opacity);
    }
    return o;
  }

  const CLICKABLE = 'a[href],button,input[type=submit],input[type=button],input[type=image],[role=button],[onclick],iframe,form';

  // Короткая подпись элемента для отчёта.
  function label(el) {
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || el.getAttribute('src') || el.tagName).trim();
    return t.replace(/\s+/g, ' ').slice(0, 80);
  }

  function hostOf(url, base) {
    try { return new URL(url, base).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  // Упрощённый «регистрируемый домен»: две последние части имени (shop.example.ru → example.ru).
  function siteOf(host) {
    const h = String(host || '').toLowerCase();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h === 'localhost') return h;
    return h.split('.').slice(-2).join('.');
  }

  const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost') || h.endsWith('.test');

  // Punycode (RFC 3492): браузер хранит русские и «похожие» буквы в домене как xn--…; раскодируем обратно.
  function punyDecode(label) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    let n = 128, i = 0, bias = 72;
    const d = label.lastIndexOf('-');
    const out = d > 0 ? [...label.slice(0, d)].map((c) => c.charCodeAt(0)) : [];
    const adapt = (delta, num, first) => {
      delta = first ? Math.floor(delta / damp) : delta >> 1;
      delta += Math.floor(delta / num);
      let k = 0;
      for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
      return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
    };
    for (let pos = d > 0 ? d + 1 : 0; pos < label.length;) {
      const oldi = i;
      for (let w = 1, k = base; ; k += base) {
        const c = label.charCodeAt(pos++);
        const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
        i += digit * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) break;
        w *= base - t;
      }
      bias = adapt(i - oldi, out.length + 1, oldi === 0);
      n += Math.floor(i / (out.length + 1));
      i %= out.length + 1;
      out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
  }

  // Домен в читаемом виде + признак смешения алфавитов в одной части имени (латиница + кириллица/греческий).
  function readableHost(host) {
    const labels = String(host || '').toLowerCase().split('.').map((l) => {
      if (!l.startsWith('xn--')) return l;
      try { return punyDecode(l.slice(4)); } catch (e) { return l; }
    });
    const mixed = labels.some((l) => /[a-z]/.test(l) && /[Ͱ-ϿЀ-ӿ]/.test(l));
    return { unicode: labels.join('.'), mixed, idn: String(host).includes('xn--') };
  }

  root.PGDom = { fieldDescription, fieldKind, isCardField, isRendered, effectiveOpacity, CLICKABLE, label, hostOf, siteOf, isLocalHost, readableHost };
})(typeof window !== 'undefined' ? window : globalThis);
