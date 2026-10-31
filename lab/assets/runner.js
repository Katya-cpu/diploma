/*
 * Запуск анализатора расширения на тестовой странице внутри фрейма лаборатории.
 * Фрейм того же сайта, поэтому лаборатория может:
 *   - начать наблюдение за изменениями (как контент-скрипт расширения);
 *   - перехватить сетевые функции страницы (в расширении это делает webRequest).
 */
(function () {
  'use strict';

  // Подготовить фрейм: дождаться, когда документ страницы разобран, и включить датчики.
  // Событие load не ждём: оно может долго ждать вложенные фреймы и картинки.
  function attach(iframe) {
    const old = iframe.contentDocument;
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const doc = iframe.contentDocument;
        if (!doc || doc === old || doc.location.href === 'about:blank' || doc.readyState === 'loading' || !doc.body) return;
        clearInterval(timer);
        const win = iframe.contentWindow;
        const sensors = PGWatch.start(doc);
        PGWatch.hookNetwork(win, sensors);
        resolve({ win, doc, sensors });
      }, 50);
    });
  }

  // Имитация ввода тестовой карты: значения заданы лабораторией, это не данные пользователя.
  function typeTestCard(doc) {
    const values = { cardNumber: '4111 1111 1111 1111', expiry: '12/30', cvv: '123', holder: 'IVAN IVANOV' };
    let typed = 0;
    for (const el of doc.querySelectorAll('input')) {
      const kind = PGDom.fieldKind(el);
      if (!values[kind]) continue;
      el.focus();
      el.value = values[kind];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      el.dispatchEvent(new Event('blur'));
      typed++;
    }
    return typed;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Полный прогон страницы: загрузка → ожидание → (ввод карты) → анализ.
  async function runPage(url, iframe) {
    const ready = attach(iframe);
    iframe.src = url;
    const { doc, sensors } = await ready;
    await wait(2800); // успеть увидеть подмены, которые делаются через 1–2 секунды
    if (doc.querySelector('input') && [...doc.querySelectorAll('input')].some((i) => PGDom.fieldKind(i) === 'cardNumber')) {
      typeTestCard(doc);
      await wait(500);
    }
    return PGChecks.inspect(doc, sensors);
  }

  // Отрисовка отчёта анализатора.
  const SEV = { danger: ['Опасно', 'danger'], warning: ['Подозрительно', 'warning'], info: ['К сведению', 'info'], error: ['Ошибка', 'info'] };
  function renderReport(report, box, focusCheck) {
    const v = PGChecks.VERDICTS[report.verdict];
    const icon = { danger: '!', warning: '?', ok: '✓', none: '–' }[report.verdict];
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'verdict ' + v.tone;
    head.innerHTML = '<span class="ic"></span><span></span>';
    head.children[0].textContent = icon; head.children[1].textContent = 'Итог анализатора: ' + v.title;
    box.append(head);
    if (!report.findings.length) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Ни одна проверка не сработала.'; box.append(p);
    }
    for (const f of report.findings) {
      const d = document.createElement('div');
      d.className = 'finding ' + f.severity;
      if (focusCheck && f.check !== focusCheck) d.style.opacity = '.6';
      const cat = PGCatalog.byId(f.check);
      d.innerHTML = '<span class="pill ' + SEV[f.severity][1] + '"></span> <span class="from"></span><b></b>';
      d.children[0].textContent = SEV[f.severity][0];
      d.children[1].textContent = 'проверка: ' + (cat ? cat.title : f.check);
      d.children[2].textContent = f.title;
      for (const t of f.details) { const p = document.createElement('p'); p.textContent = t; d.append(p); }
      box.append(d);
    }
    if (report.limits.length) {
      const l = document.createElement('div'); l.className = 'note warn'; l.style.marginTop = '12px';
      l.innerHTML = '<b>Что анализатор не смог проверить:</b><ul style="margin:6px 0 0;padding-left:18px"></ul>';
      report.limits.forEach((t) => { const li = document.createElement('li'); li.textContent = t; l.querySelector('ul').append(li); });
      box.append(l);
    }
    const det = document.createElement('details'); det.style.marginTop = '12px';
    det.innerHTML = '<summary class="small" style="cursor:pointer;font-weight:600">Что «увидел» анализатор (наблюдения в формате JSON)</summary><pre class="json"></pre>';
    det.querySelector('pre').textContent = JSON.stringify({ context: report.context, recipient: report.recipient }, null, 2);
    box.append(det);
  }

  window.LabRunner = { attach, typeTestCard, runPage, renderReport, wait };
})();
