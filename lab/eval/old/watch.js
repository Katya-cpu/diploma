/*
 * Наблюдение за страницей во времени (MutationObserver):
 *  - подменились ли реквизиты после загрузки;
 *  - добавил ли скрипт новые поля для карты;
 *  - когда пользователь начал вводить данные карты (только момент, без значения).
 * В лаборатории дополнительно перехватываются сетевые вызовы учебной страницы
 * (в расширении эту роль выполняет webRequest в background.js).
 */
(function (root) {
  'use strict';
  const R = root.PGRecipient, D = root.PGDom;

  function requisiteMap(text) {
    const r = R.findRequisites(text);
    const map = new Map();
    for (const c of r.cards) map.set(c.value, { kind: 'карта', masked: c.masked });
    for (const p of r.phones) map.set(p.value, { kind: 'телефон', masked: p.masked });
    for (const a of r.accounts) map.set(a.value, { kind: 'счёт', masked: a.masked });
    return map;
  }

  function start(doc, onChange) {
    const state = {
      startedAt: Date.now(),
      changes: [],          // подмены реквизитов
      addedCardFields: 0,   // поля карты, вставленные скриптом после начала наблюдения
      cardInputAt: null,    // момент первого ввода в поле карты
      network: [],          // сетевые вызовы (заполняется лабораторией или background.js)
    };
    const initial = requisiteMap(doc.body ? doc.body.innerText : '');
    const reported = new Set();
    let timer = null;

    function compare() {
      const now = requisiteMap(doc.body ? doc.body.innerText : '');
      const removed = [...initial.keys()].filter((k) => !now.has(k));
      const added = [...now.keys()].filter((k) => !initial.has(k) && !reported.has(k));
      for (const k of added) {
        const from = removed.map((r) => initial.get(r)).find((x) => x.kind === now.get(k).kind);
        if (!from) continue;
        reported.add(k);
        state.changes.push({ kind: now.get(k).kind, from: from.masked, to: now.get(k).masked, afterMs: Date.now() - state.startedAt });
      }
      if (onChange) onChange(state);
    }

    const observer = new doc.defaultView.MutationObserver((records) => {
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (n.nodeType !== 1) continue;
          const inputs = n.matches('input') ? [n] : [...n.querySelectorAll('input')];
          state.addedCardFields += inputs.filter((i) => D.fieldKind(i) === 'cardNumber').length;
        }
      }
      clearTimeout(timer);
      timer = setTimeout(compare, 300);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

    doc.addEventListener('input', (e) => {
      if (!state.cardInputAt && D.isCardField(e.target)) {
        state.cardInputAt = Date.now();
        if (onChange) onChange(state);
      }
    }, true);

    state.stop = () => observer.disconnect();
    return state;
  }

  // Только для лаборатории: учебная страница открыта во фрейме того же сайта,
  // поэтому можно подменить её сетевые функции и записывать, куда она пытается отправить данные.
  // Запросы при этом никуда не уходят.
  function hookNetwork(win, state) {
    const record = (url, how) => {
      const host = D.hostOf(url, win.location.href);
      state.network.push({ host, how, at: Date.now(), afterCardInput: !!state.cardInputAt });
    };
    win.fetch = (url) => { record(typeof url === 'string' ? url : url.url, 'fetch'); return Promise.resolve(new win.Response('')); };
    win.navigator.sendBeacon = (url) => { record(url, 'sendBeacon'); return true; };
    const xhr = win.XMLHttpRequest.prototype;
    xhr.open = function (m, url) { record(url, 'XMLHttpRequest'); };
    xhr.send = xhr.setRequestHeader = function () { /* не отправляем */ };
    const desc = Object.getOwnPropertyDescriptor(win.HTMLImageElement.prototype, 'src');
    Object.defineProperty(win.HTMLImageElement.prototype, 'src', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) {
        const host = D.hostOf(v, win.location.href);
        if (host && host !== win.location.hostname && !String(v).startsWith('data:')) { record(v, 'картинка-пиксель'); return; }
        desc.set.call(this, v);
      },
    });
    win.WebSocket = function (url) { record(url, 'WebSocket'); return { send() {}, close() {} }; };
  }

  root.PGWatch = { start, hookNetwork };
})(typeof window !== 'undefined' ? window : globalThis);
