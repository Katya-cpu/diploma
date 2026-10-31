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
    return parts.filter(Boolean).join(' ').toLowerCase().slice(0, 300);
  }

  // Тип поля по атрибутам autocomplete (стандарт HTML) и подписям на русском и английском.
  const FIELD_KINDS = [
    ['cardNumber', /cc-number|card.?num|cardnumber|номер карты|номер банковской карты|pan\b/],
    ['cvv', /cc-csc|\bcvv|\bcvc|\bcsc|cvv2|cvc2|код безопасности|трёхзначный код|3 цифры на обороте/],
    ['expiry', /cc-exp|expir|срок действия|мм\s*\/\s*гг|mm\s*\/\s*yy/],
    ['holder', /cc-name|cardholder|имя владельца|держател/],
    ['smsCode', /код из (?:смс|sms)|sms.?code|одноразов|код подтвержден|otp/],
    ['bankPassword', /пароль от (?:интернет|онлайн|мобильн).{0,10}банк|кодовое слово|pin-?код|пин-?код/],
    ['balance', /баланс|остаток на карте|остаток средств/],
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

  root.PGDom = { fieldDescription, fieldKind, isCardField, isRendered, effectiveOpacity, CLICKABLE, label, hostOf, siteOf, isLocalHost };
})(typeof window !== 'undefined' ? window : globalThis);
