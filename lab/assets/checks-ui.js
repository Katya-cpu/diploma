// Раздел 1: каталог проверок + тестовая страница + решение анализатора.
(function () {
  'use strict';
  const C = PGCatalog.CATALOG;
  const side = document.getElementById('side');
  const detail = document.getElementById('detail');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const EXPECT = { danger: ['опасно', 'danger'], warning: ['подозрительно', 'warning'], ok: ['признаков нет', 'ok'] };

  // ---------- Список проверок слева ----------
  let group = '';
  C.forEach((c, i) => {
    if (c.group !== group) { group = c.group; side.insertAdjacentHTML('beforeend', '<h4>' + esc(group) + '</h4>'); }
    side.insertAdjacentHTML('beforeend', '<a href="#' + c.id + '" data-id="' + c.id + '"><span class="n">' + (i + 1) + '</span>' + esc(c.title) + '</a>');
  });

  function show(id) {
    const c = PGCatalog.byId(id) || C[0];
    side.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === c.id));
    const n = C.indexOf(c) + 1;
    detail.innerHTML = `
      <div class="card head">
        <div class="eyebrow">Проверка ${n} из ${C.length} · ${esc(c.group)} · код <code>${c.id}</code></div>
        <h1>${esc(c.title)}</h1>
        <div class="tax">${c.taxonomy.map((t) => `<a class="pill accent" target="_blank" href="${t.url}" title="${esc(t.name)}">${esc(t.id)} · ${esc(t.name)}</a>`).join('')}</div>
      </div>
      <div class="cols">
        <div class="card desc">
          <h3>Какую мошенническую схему ловит</h3>
          <p class="scheme">${esc(c.scheme)}</p>
          <h3>По каким данным</h3>
          <ul>${c.data.map((d) => '<li>' + esc(d) + '</li>').join('')}</ul>
          <h3>Как работает анализ</h3>
          <ol>${c.method.map((d) => '<li>' + esc(d) + '</li>').join('')}</ol>
          <h3>Технология</h3>
          <p>${esc(c.technology)}</p>
          <h3>Ограничения</h3>
          <ul>${c.limits.map((d) => '<li>' + esc(d) + '</li>').join('')}</ul>
          <h3>Источники сценария</h3>
          <div class="src">${c.sources.map((s) => `<a target="_blank" href="${s.url}">↗ ${esc(s.title)}</a>`).join('')}</div>
        </div>
        <div>
          <div class="bench">
            <div class="bar">
              <span class="seg">${c.pages.map((p, i) => `<button data-i="${i}">${esc(p.label)}</button>`).join(' ')}</span>
              <span style="margin-left:auto"></span>
              <a class="btn ghost" id="open" target="_blank" title="Открыть отдельно — для проверки расширением">↗ Отдельно</a>
            </div>
            <iframe id="frame" title="Тестовая страница"></iframe>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn accent" id="analyze">Запустить анализатор</button>
            <button class="btn ghost" id="type" hidden>Ввести тестовую карту</button>
            <span class="pill" id="expect" style="align-self:center"></span>
          </div>
          <div id="result"></div>
        </div>
      </div>`;

    const frame = detail.querySelector('#frame');
    const result = detail.querySelector('#result');
    let sensors = null, current = 0;

    async function load(i) {
      current = i;
      const page = c.pages[i];
      detail.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === i));
      detail.querySelector('#open').href = '/pages/' + page.file;
      const e = EXPECT[page.expect];
      detail.querySelector('#expect').className = 'pill ' + e[1];
      detail.querySelector('#expect').textContent = 'Ожидаемый итог: ' + e[0];
      result.innerHTML = '<p class="muted small">Нажмите «Запустить анализатор». Наблюдение за страницей уже идёт.</p>';
      const ready = LabRunner.attach(frame);
      frame.src = '/pages/' + page.file;
      ({ sensors } = await ready);
      detail.querySelector('#type').hidden = ![...frame.contentDocument.querySelectorAll('input')].some((x) => PGDom.fieldKind(x) === 'cardNumber');
    }
    async function analyze() {
      result.innerHTML = '<p class="muted">Анализ…</p>';
      const report = await PGChecks.inspect(frame.contentDocument, sensors);
      LabRunner.renderReport(report, result, c.id);
    }
    detail.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => load(Number(b.dataset.i))));
    detail.querySelector('#analyze').addEventListener('click', analyze);
    detail.querySelector('#type').addEventListener('click', async () => {
      LabRunner.typeTestCard(frame.contentDocument);
      await LabRunner.wait(400);
      analyze();
    });
    load(0);
  }

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1) || C[0].id);

  // ---------- Прогон всех тестовых страниц ----------
  document.getElementById('runAll').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const box = document.getElementById('summary');
    box.innerHTML = `<div class="card" style="margin-bottom:24px"><h2 style="margin-top:0">Сводка прогона</h2>
      <p class="muted small" id="prog"></p>
      <table><thead><tr><th>Проверка</th><th>Тестовая страница</th><th>Ожидалось</th><th>Решение анализатора</th><th>Сработавшие признаки</th><th></th></tr></thead><tbody></tbody></table></div>`;
    const tbody = box.querySelector('tbody');
    const hidden = document.createElement('iframe');
    hidden.style.cssText = 'position:absolute;left:-2000px;top:0;width:1000px;height:700px;border:0';
    document.body.append(hidden);
    let pass = 0, total = 0;
    for (const c of C) {
      for (const p of c.pages) {
        total++;
        box.querySelector('#prog').textContent = 'Проверяется: ' + p.file + ' (' + total + ')';
        const r = await LabRunner.runPage('/pages/' + p.file, hidden);
        const fired = r.findings.filter((f) => f.severity !== 'info');
        const own = r.findings.some((f) => f.check === c.id && f.severity !== 'info');
        const ok = p.expect === 'ok' ? (r.verdict === 'ok' || r.verdict === 'none') : (r.verdict === p.expect || (p.expect === 'warning' && r.verdict === 'danger')) && own;
        if (ok) pass++;
        const v = PGChecks.VERDICTS[r.verdict];
        tbody.insertAdjacentHTML('beforeend', `<tr><td><a href="#${c.id}">${esc(c.title)}</a></td><td>${esc(p.label)}<div class="muted small">${p.file}</div></td>
          <td><span class="pill ${EXPECT[p.expect][1]}">${EXPECT[p.expect][0]}</span></td><td><span class="pill ${v.tone === 'none' ? 'info' : v.tone}">${esc(v.title)}</span></td>
          <td class="small">${fired.map((f) => esc(f.title)).join('<br>') || '—'}</td><td>${ok ? '<span class="ok-mark">✓</span>' : '<span class="bad-mark">✗</span>'}</td></tr>`);
      }
    }
    hidden.remove();
    box.querySelector('#prog').innerHTML = `<b>Совпало ${pass} из ${total}.</b> «Совпало» = итог как ожидался и сработала именно своя проверка; для честных страниц — нет ни одного предупреждения (ложной тревоги).`;
    btn.disabled = false;
  });
  if (new URLSearchParams(location.search).has('autorun')) document.getElementById('runAll').click();
})();
