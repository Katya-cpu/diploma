/*
 * Реквизиты получателя: поиск в тексте, проверка контрольных сумм и определение,
 * кому на самом деле уйдут деньги (частному лицу или организации).
 * Используется и расширением, и лабораторией. Ничего не отправляет в сеть.
 */
(function (root) {
  'use strict';

  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

  // ---------- Карта: алгоритм Луна (ISO/IEC 7812) и платёжная система ----------
  function luhnValid(number) {
    const d = onlyDigits(number);
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  }

  function cardSystem(number) {
    const d = onlyDigits(number);
    const p4 = Number(d.slice(0, 4));
    if (p4 >= 2200 && p4 <= 2204) return 'Мир';
    if (p4 >= 2221 && p4 <= 2720) return 'Mastercard';
    if (/^4/.test(d)) return 'Visa';
    if (/^5[1-5]/.test(d)) return 'Mastercard';
    if (/^62/.test(d)) return 'UnionPay';
    return 'неизвестная система';
  }

  // ---------- Счёт: тип по балансовому счёту (План счетов, Положение Банка России № 809-П) ----------
  const ACCOUNT_TYPES = [
    ['40817', 'person', 'текущий счёт физического лица'],
    ['40820', 'person', 'счёт физического лица — нерезидента'],
    ['423', 'deposit', 'вклад (депозит) физического лица'],
    ['426', 'deposit', 'вклад физического лица — нерезидента'],
    ['40802', 'entrepreneur', 'счёт индивидуального предпринимателя'],
    ['40701', 'company', 'счёт финансовой организации'],
    ['40702', 'company', 'счёт коммерческой организации'],
    ['40703', 'company', 'счёт некоммерческой организации'],
    ['03100', 'treasury', 'казначейский счёт (бюджетный платёж)'],
    ['40101', 'treasury', 'счёт казначейства'],
    ['30101', 'bank', 'корреспондентский счёт банка'],
  ];

  function accountType(account) {
    const d = onlyDigits(account);
    for (const [prefix, kind, label] of ACCOUNT_TYPES) {
      if (d.startsWith(prefix)) return { kind, label };
    }
    return { kind: 'unknown', label: 'тип счёта не определён' };
  }

  // Контрольный ключ счёта по БИК: «Порядок расчёта контрольного ключа в номере лицевого счёта», Банк России № 515.
  // 3 цифры из БИК + 20 цифр счёта, веса 7-1-3, суммируем младшие разряды произведений; сумма должна оканчиваться на 0.
  function accountKeyValid(account, bic) {
    const acc = onlyDigits(account), b = onlyDigits(bic);
    if (acc.length !== 20 || b.length !== 9) return null; // нечего проверять
    if (acc.startsWith('03') || acc.startsWith('40101')) return null; // казначейские счета считаются иначе
    const tail = b.slice(-3);
    const prefix = ['000', '001', '002'].includes(tail) ? '0' + b.slice(4, 6) : tail;
    const all = prefix + acc;
    const weights = [7, 1, 3];
    let sum = 0;
    for (let i = 0; i < 23; i++) sum += (Number(all[i]) * weights[i % 3]) % 10;
    return sum % 10 === 0;
  }

  // ---------- ИНН: контрольные цифры (приказ ФНС) ----------
  function innValid(inn) {
    const d = onlyDigits(inn).split('').map(Number);
    const check = (w) => (w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10;
    if (d.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
    if (d.length === 12) {
      return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] &&
             check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
    }
    return false;
  }

  // ---------- Маскирование: в отчётах реквизиты показываются только окончанием ----------
  const mask = (s) => '•••• ' + onlyDigits(s).slice(-4);
  const maskPhone = (p) => { const d = onlyDigits(p); return '+7 ••• •••-' + d.slice(-4, -2) + '-' + d.slice(-2); };

  // ---------- Поиск реквизитов в тексте страницы ----------
  function findRequisites(text) {
    const t = String(text || '');
    const out = { cards: [], phones: [], accounts: [], bic: null, inn: null, name: null };
    const seen = new Set();

    for (const m of t.matchAll(/(?<!\d)(?:\d{4}[ \-]?){3}\d{4}(?:\d{1,3})?(?!\d)/g)) {
      const d = onlyDigits(m[0]);
      if (seen.has(d) || !luhnValid(d)) continue; // случайные числа отсекаются контрольной суммой
      seen.add(d);
      out.cards.push({ value: d, masked: mask(d), system: cardSystem(d) });
    }
    for (const m of t.matchAll(/(?<![\d+])(?:\+7|8)[\s\-(]*9\d{2}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)/g)) {
      const d = '7' + onlyDigits(m[0]).slice(1);
      if (seen.has(d)) continue;
      seen.add(d);
      out.phones.push({ value: d, masked: maskPhone(d) });
    }
    for (const m of t.matchAll(/(?<!\d)\d{5}[ .]?\d{3}[ .]?\d[ .]?\d{4}[ .]?\d{7}(?!\d)/g)) {
      const d = onlyDigits(m[0]);
      if (d.length !== 20 || seen.has(d)) continue;
      seen.add(d);
      out.accounts.push({ value: d, masked: mask(d), type: accountType(d) });
    }
    const bic = t.match(/БИК[:\s№]*(\d{9})(?!\d)/i);
    if (bic) out.bic = bic[1];
    const inn = t.match(/ИНН[:\s№]*(\d{12}|\d{10})(?!\d)/i);
    if (inn) out.inn = inn[1];
    const name = t.match(/Получател[ья][:\s]+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]*\.?){1,2})/);
    if (name) out.name = name[1].trim();
    return out;
  }

  // ---------- Платёжные QR-коды ----------
  // ГОСТ Р 56042-2014: «ST0001<кодировка>|Name=...|PersonalAcc=...|BIC=...|Sum=<копейки>|...»
  function parseGostQr(raw) {
    const s = String(raw || '');
    const m = s.match(/^ST0001([123])(.)/);
    if (!m) return null;
    const fields = {};
    for (const part of s.slice(7).split(m[2])) {
      const i = part.indexOf('=');
      if (i > 0) fields[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return {
      format: 'ГОСТ Р 56042-2014',
      name: fields.Name || null,
      account: fields.PersonalAcc || null,
      bic: fields.BIC || null,
      bank: fields.BankName || null,
      inn: fields.PayeeINN || null,
      sum: fields.Sum ? Number(fields.Sum) / 100 : null, // в стандарте сумма в копейках
      purpose: fields.Purpose || null,
    };
  }

  // СБП: https://qr.nspk.ru/<id>?type=01|02&sum=<копейки>&cur=RUB — получатель виден только в приложении банка.
  function parseSbpLink(raw) {
    let url;
    try { url = new URL(String(raw).trim()); } catch (e) { return null; }
    const host = url.hostname.toLowerCase();
    const looksSbp = /nspk|sbp|сбп/i.test(host + url.pathname);
    if (!looksSbp) return null;
    const sum = url.searchParams.get('sum');
    return {
      format: 'Ссылка СБП',
      host,
      official: host === 'qr.nspk.ru' && url.protocol === 'https:',
      dynamic: url.searchParams.get('type') === '02',
      sum: sum ? Number(sum) / 100 : null,
    };
  }

  // ---------- Кем представляется страница ----------
  // Если страница говорит от имени магазина, службы доставки, банка или ведомства,
  // ожидается счёт организации, а не карта/телефон/счёт частного лица.
  const ROLE_PATTERNS = [
    ['служба безопасности банка', /служб[а-яё\w]* безопасности|безопасн[а-яё\w]+ сч[её]т|резервн[а-яё\w]+ сч[её]т|защищ[её]нн[а-яё\w]+ сч[её]т/i],
    ['магазин или площадка', /интернет-магазин|магазин|маркетплейс|площадк|заказ|корзин|объявлени/i],
    ['служба доставки', /доставк|курьер|пункт выдачи|трек-номер/i],
    ['организация или ведомство', /(?:^|\s)(?:ООО|АО|ПАО)\s|управляющ[а-яё\w]+ компани|квитанц|штраф|налог|ЖКХ|госпошлин/i],
  ];

  function pageRole(text) {
    for (const [role, re] of ROLE_PATTERNS) if (re.test(text)) return role;
    return null;
  }

  root.PGRecipient = {
    onlyDigits, luhnValid, cardSystem, accountType, accountKeyValid, innValid,
    findRequisites, parseGostQr, parseSbpLink, pageRole, mask, maskPhone,
  };
})(typeof window !== 'undefined' ? window : globalThis);
