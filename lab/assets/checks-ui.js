// Раздел «Проверки»: описание каждой проверки простым языком + тестовая страница + решение анализатора.
(function () {
  'use strict';
  const C = PGCatalog.CATALOG;
  const side = document.getElementById('side');
  const detail = document.getElementById('detail');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const EXPECT = { danger: ['опасно', 'danger'], warning: ['подозрительно', 'warning'], ok: ['признаков нет', 'ok'] };
  const LEVEL = { danger: 'Опасно', warning: 'Подозрительно', info: 'К сведению' };
  const EVID = { strong: 'Подтверждено реальными случаями', partial: 'Подтверждено частично', weak: 'Слабо подтверждено' };
  const pageUrl = (p) => '/' + (p.dir || 'pages') + '/' + p.file;
  const SCH = PGSchemes.SCHEMES;

  // Номера проверок: основные — 1, 2, 3…; часть другой проверки — номер основной с буквой («7а»).
  const NUM = {};
  { let n = 0; const sub = {}; for (const c of C) {
    if (c.partOf) { sub[c.partOf] = (sub[c.partOf] || 0) + 1; NUM[c.id] = NUM[c.partOf] + 'абвг'[sub[c.partOf] - 1]; } else NUM[c.id] = String(++n);
  } }
  const MAIN = C.filter((c) => !c.partOf).length;
  const checkLink = (id) => `<a href="#${id}">${NUM[id]}. ${esc(PGCatalog.byId(id).title)}</a>`;

  // ---------- Список слева: сначала виды мошенничества, затем проверки ----------
  side.insertAdjacentHTML('beforeend', '<h3>Виды мошенничества</h3>');
  SCH.forEach((x) => side.insertAdjacentHTML('beforeend', '<a href="#s-' + x.id + '" data-id="s-' + x.id + '"><span class="dot ' + x.evidence[0] + '"></span>' + esc(x.title) + '</a>'));
  side.insertAdjacentHTML('beforeend', '<h3>Проверки расширения</h3>');
  let group = '';
  C.forEach((c) => {
    if (c.group !== group && !c.partOf) { group = c.group; side.insertAdjacentHTML('beforeend', '<h4>' + esc(group) + '</h4>'); }
    side.insertAdjacentHTML('beforeend', '<a href="#' + c.id + '" data-id="' + c.id + '"' + (c.partOf ? ' class="sub"' : '') + '><span class="n">' + NUM[c.id] + '</span>' + esc(c.title) + '</a>');
  });

  const caseHtml = (k) => `<div class="case"><div class="when">${esc(k.when)}</div>
        <div><b>${esc(k.name)}</b> — ${esc(k.what)} <a target="_blank" rel="noopener" href="${k.source.url}">Источник</a>
        ${k.shot ? `<a class="shot" target="_blank" href="/${k.shot}"><img src="/${k.shot}" alt="Снимок настоящей страницы: ${esc(k.name)}"><span>Снимок настоящей страницы. Источник: urlscan.io</span></a>` : ''}</div></div>`;

  // Классификация схемы: собственные пункты схемы (x.taxonomy) и все пункты проверок, которые в ней срабатывают.
  // Номера не придумываются заново: у проверок они сверены с каталогами MITRE (docs/scenario-evidence.md).
  function schemeTaxonomy(x) {
    const rows = new Map();
    for (const t of x.taxonomy || []) rows.set(t.id, { t, from: ['схема целиком'] });
    for (const k of x.checks) for (const t of PGCatalog.byId(k.id).taxonomy) {
      if (!rows.has(t.id)) rows.set(t.id, { t, from: [] });
      rows.get(t.id).from.push(NUM[k.id]);
    }
    const order = (id) => (id.startsWith('CAPEC') ? 0 : id.startsWith('ATT') ? 1 : 2);
    const list = [...rows.values()].sort((a, b) => order(a.t.id) - order(b.t.id));
    return `<h2>Классификация MITRE</h2>
      <p class="small muted">CAPEC — шаблоны атак, ATT&amp;CK — техники злоумышленников, F3 (Fight Fraud Framework) — техники мошенничества.
      В правом столбце — из какой проверки пришёл номер.</p>
      <table class="tax"><tbody>${list.map(({ t, from }) => `<tr><td><a target="_blank" rel="noopener" href="${t.url}">${esc(t.id)}</a></td>
        <td><b>${esc(t.name)}</b><br><span class="muted">${esc(t.why)}</span></td><td class="muted">${esc(from.join(', '))}</td></tr>`).join('')}</tbody></table>`;
  }

  // Настоящие страницы схемы: снимок оригинала и та же страница в Firefox с расширением (tools/real_pages.py).
  const VERD = { danger: 'опасно', warning: 'подозрительно', none: 'молчит', ok: 'молчит', timeout: 'не загрузилась' };
  function realPages(x) {
    const G = window.REAL_GALLERY;
    const list = (G && G.schemes[x.id]) || [];
    if (!list.length) return `<h2>Настоящие страницы</h2><p class="muted">Настоящих страниц этой схемы с сохранённым кодом пока нет.</p>`;
    const shots = list.filter((r) => r.img);
    const rest = list.filter((r) => !r.img);
    const n = (v) => list.filter((r) => r.verdict === v).length;
    const tested = list.filter((r) => r.verdict).length;
    const card = (r) => `<figure class="realshot">
        <a target="_blank" href="/${r.img}"><img loading="lazy" src="/${r.img}" alt="${esc(r.domain)}: снимок страницы и панель помощника"></a>
        <figcaption><span class="vb ${r.verdict || 'na'}">${VERD[r.verdict] || 'не проверялась'}</span>
          <b>${esc(r.domain)}</b> · ${esc(r.date)} · ${esc(r.source)}${r.link ? ` · <a target="_blank" rel="noopener" href="${r.link}">открыть в песочнице</a>` : ''}
          ${r.titles && r.titles.length ? `<br>${esc(r.titles.join('; '))}` : ''}${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}</figcaption></figure>`;
    return `<h2>Настоящие страницы и что показал помощник</h2>
      <p class="small muted">Сохранённый код каждой страницы открыт в Firefox с расширением; скрипты страницы и сетевые запросы запрещены,
      поэтому картинки и стили не грузятся, а в тексте панели вместо адреса мошенников стоит адрес лаборатории (127.0.0.1).
      Слева — снимок оригинала из источника. Проверено ${tested}: «опасно» — ${n('danger')}, «подозрительно» — ${n('warning')}, молчит — ${n('none') + n('ok')}.</p>
      <div class="realgrid">${shots.map(card).join('')}</div>
      ${rest.length ? `<details class="realmore"><summary>Ещё ${rest.length} страниц — списком</summary><table class="signals"><tbody>${rest.map((r) =>
        `<tr><td><span class="vb ${r.verdict || 'na'}">${VERD[r.verdict] || 'не проверялась'}</span></td><td><b>${esc(r.domain)}</b> · ${esc(r.date)} · ${esc(r.source)}<br><span class="muted">${esc(r.title || '')}${r.note ? ' — ' + esc(r.note) : ''}</span></td>
         <td>${r.orig ? `<a target="_blank" href="/${r.orig}">снимок</a>` : ''} ${r.link ? `<a target="_blank" rel="noopener" href="${r.link}">песочница</a>` : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
  }

  // ---------- Вид мошенничества ----------
  function showScheme(x) {
    side.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === 's-' + x.id));
    const srcs = [...new Map(x.cases.map((k) => [k.source.url, k.source])).values()];
    detail.innerHTML = `
      <div class="head">
        <div class="eyebrow">Вид мошенничества ${SCH.indexOf(x) + 1} из ${SCH.length}</div>
        <h1>${esc(x.title)}</h1>
        <p class="plain">${esc(x.plain)}</p>
        <p class="evid ${x.evidence[0]}"><b>${EVID[x.evidence[0]]}.</b> ${esc(x.evidence[1])}</p>
      </div>
      <h2>Как теряют деньги</h2>
      <p class="money">${esc(x.money)}</p>
      <h2>Реальные случаи</h2>
      <div class="cases">${x.cases.map(caseHtml).join('')}</div>
      ${realPages(x)}
      <h2>Что ловит помощник</h2>
      <table class="signals"><tbody>${x.checks.map((k) => `<tr><td>${checkLink(k.id)}</td><td>${esc(k.role)}</td></tr>`).join('')}</tbody></table>
      <h2>Чего помощник в этой схеме не видит</h2>
      <ul class="limits">${x.blind.map((d) => '<li>' + esc(d) + '</li>').join('')}</ul>
      ${schemeTaxonomy(x)}
      <h2>Источники</h2>
      <div class="src">${srcs.map((q) => `<a target="_blank" rel="noopener" href="${q.url}">${esc(q.title)}</a>`).join('')}</div>`;
    window.scrollTo(0, 0);
  }

  // ---------- «Вот это место в коде страницы»: настоящая строка из файла тестовой страницы ----------
  // Файл читается с диска как текст, поэтому показано ровно то, что человек увидит в браузере по Ctrl+U
  // или во вкладке «Инспектор» / «Отладчик».
  async function codeExcerpt(look) {
    let text = '';
    try { text = await (await fetch('/' + look.file)).text(); } catch (e) { return ''; }
    const lines = text.split('\n');
    const re = new RegExp(look.find, 'i');
    const at = lines.findIndex((l) => re.test(l));
    if (at < 0) return '';
    const cut = (l) => (l.length > 230 ? l.slice(0, 230) + ' …' : l);
    const mark = (l) => {
      const m = l.match(re);
      const start = Math.max(0, m.index - 90);
      const view = (start ? '… ' : '') + l.slice(start, m.index + m[0].length + 130) + (l.length > m.index + m[0].length + 130 ? ' …' : '');
      const i = view.toLowerCase().indexOf(m[0].toLowerCase());
      return esc(view.slice(0, i)) + '<mark>' + esc(view.slice(i, i + m[0].length)) + '</mark>' + esc(view.slice(i + m[0].length));
    };
    let rows = '';
    for (let i = Math.max(0, at - 1); i <= Math.min(lines.length - 1, at + 1); i++) {
      rows += '<div class="ln' + (i === at ? ' hit' : '') + '"><span>' + (i + 1) + '</span><code>' + (i === at ? mark(lines[i]) : esc(cut(lines[i]))) + '</code></div>';
    }
    return '<figure class="code"><figcaption><b>' + esc(look.file) + '</b>, строка ' + (at + 1) + ' — ' + esc(look.note) + '</figcaption>' + rows + '</figure>';
  }

  function show(id) {
    if (!id || id.startsWith('s-')) return showScheme(PGSchemes.byId((id || '').slice(2)) || SCH[0]);
    const c = PGCatalog.byId(id) || C[0];
    const parent = c.partOf && PGCatalog.byId(c.partOf);
    const parts = C.filter((q) => q.partOf === c.id);
    const used = PGSchemes.forCheck(c.id);
    side.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === c.id));
    detail.innerHTML = `
      <div class="head">
        <div class="eyebrow">Проверка ${NUM[c.id]}${parent ? ' — часть проверки ' + NUM[parent.id] : ' из ' + MAIN} · ${esc(c.group)}</div>
        <h1>${esc(c.title)}</h1>
        <p class="plain">${esc(c.plain)}</p>
        ${parent ? `<p class="rel">Это часть проверки ${checkLink(parent.id)}: признаки показываются вместе.</p>` : ''}
        ${parts.length ? `<p class="rel">Включает: ${parts.map((q) => checkLink(q.id)).join(', ')}.</p>` : ''}
        ${used.length ? `<p class="rel">Работает в схемах: ${used.map((x) => `<a href="#s-${x.id}">${esc(x.title)}</a>`).join('; ')}.</p>` : ''}
      </div>

      <h2>Где этот признак встречался на самом деле</h2>
      <div class="cases">${c.cases.map(caseHtml).join('')}</div>

      <h2>Попробовать на странице</h2>
      <div class="bench">
        <div class="bar">
          <span class="seg">${c.pages.map((p, i) => `<button data-i="${i}">${esc(p.label)}${p.dir === 'pages' ? ' <small>· проверка признака</small>' : ''}</button>`).join(' ')}</span>
        </div>
        <p class="muted small bench-note" id="kind"></p>
        <iframe id="frame" title="Тестовая страница"></iframe>
      </div>
      <div class="actions">
        <button class="btn" id="analyze">Запустить анализатор</button>
        <button class="btn ghost" id="type" hidden>Ввести тестовую карту</button>
        <a class="btn ghost" id="open" target="_blank" title="Открыть в отдельной вкладке — так страницу проверит само расширение">Открыть отдельно (для расширения)</a>
        <span class="pill" id="expect"></span>
      </div>
      <div id="result"></div>

      <h2>Что именно проверяет это правило</h2>
      <p class="muted small">Полный список: всё, что написано ниже, и есть правило. Других условий в коде нет (<code>extension/core/checks.js</code>, проверка <code>${c.id}</code>).</p>
      <table class="signals"><tbody>${c.signals.map((s) => `<tr><td><span class="pill ${s.level}">${LEVEL[s.level]}</span></td><td>${esc(s.text)}</td></tr>`).join('')}</tbody></table>

      <h2>Как увидеть это самому, без помощника</h2>
      <p class="muted small">Инструмент: ${esc(c.manual.tool)}. Откройте тестовую страницу отдельно и повторите шаги.</p>
      <ol class="steps">${c.manual.steps.map((s) => '<li>' + esc(s) + '</li>').join('')}</ol>
      <div id="look"></div>

      <h2>Чего проверка не видит</h2>
      <ul class="limits">${c.limits.map((d) => '<li>' + esc(d) + '</li>').join('')}</ul>

      <h2>Классификация MITRE</h2>
      <table class="tax"><tbody>${c.taxonomy.map((t) => `<tr><td><a target="_blank" rel="noopener" href="${t.url}">${esc(t.id)}</a></td><td><b>${esc(t.name)}</b><br><span class="muted">${esc(t.why)}</span></td></tr>`).join('')}</tbody></table>

      <h2>Источники</h2>
      <div class="src">${c.sources.map((s) => `<a target="_blank" rel="noopener" href="${s.url}">${esc(s.title)}</a>`).join('')}</div>`;

    const frame = detail.querySelector('#frame');
    const result = detail.querySelector('#result');
    let sensors = null;

    Promise.all(c.look.map(codeExcerpt)).then((parts) => {
      const box = detail.querySelector('#look');
      if (box && parts.join('')) box.innerHTML = '<p class="muted small">Вот это место в коде тестовой страницы (то же вы увидите в инструментах разработчика):</p>' + parts.join('');
    });

    async function load(i) {
      const page = c.pages[i];
      detail.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === i));
      detail.querySelector('#open').href = pageUrl(page);
      detail.querySelector('#kind').textContent = page.dir === 'pages'
        ? 'Проверка одного признака: минимальная страница, на которой есть только то, что проверяет правило. Это не имитация сайта — как выглядят настоящие мошеннические страницы, см. снимки выше.'
        : 'Учебный сайт: приём из реального случая на вымышленном бренде.';
      const e = EXPECT[page.expect];
      detail.querySelector('#expect').className = 'pill ' + e[1];
      detail.querySelector('#expect').textContent = 'Ожидаемый итог: ' + e[0];
      result.innerHTML = '';
      const ready = LabRunner.attach(frame);
      frame.src = pageUrl(page);
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
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));

  // ---------- На чём ещё проверить: источники настоящих страниц ----------
  const shots = document.getElementById('realShots');
  if (shots) {
    shots.innerHTML = PGCatalog.REAL_PAGES.map((r) => `<figure class="realshot"><a target="_blank" href="/${r.file}"><img src="/${r.file}" alt="${esc(r.title)}"></a>
      <figcaption><b>${esc(r.title)}</b> · ${esc(r.date)}<br>${esc(r.what)}<br>Проверки: ${r.checks.map(checkLink).join(', ') || '—'} · <a target="_blank" rel="noopener" href="${r.source.url}">Источник</a></figcaption></figure>`).join('');
  }
  const run = document.getElementById('realRun');
  if (run && window.URLSCAN_RESULTS) {
    const R = window.URLSCAN_RESULTS, s = R.summary;
    const V = { danger: ['опасно', 'danger'], warning: ['подозрительно', 'warning'], ok: ['признаков нет', 'ok'], none: ['признаков нет', 'info'] };
    const rows = R.rows.filter((r) => r.verdict !== 'none' || r.scheme === 'brand');
    run.innerHTML = `<p class="small" style="color:var(--ink2)">${esc(R.date)}: с urlscan.io скачан код ${s.all} настоящих страниц, и на нём запущен тот же анализатор, что в расширении. Скрипты страниц не выполнялись, сетевые запросы были запрещены.</p>
      <ul class="small" style="color:var(--ink2)">
        <li><b>ClickFix, ${s.clickfix.n} страниц:</b> «опасно» — ${s.clickfix.danger}, «подозрительно» — ${s.clickfix.warning}. На всех ${s.clickfix.danger + s.clickfix.warning} страницах, где «капча» есть в сохранённом коде, она найдена. На остальных ${s.clickfix.n - s.clickfix.danger - s.clickfix.warning} в коде только загрузчик: подделку подгружает чужой скрипт по условию (например, только посетителям с Windows), а без выполнения чужого кода её не видно.</li>
        ${s.other ? `<li><b>Другие схемы, ${s.other.n} страниц</b> (подписочная ловушка, «вас взломали — позвоните», магазины со скиммером, поддельные ведомства и штрафы): «опасно» — ${s.other.danger}, «подозрительно» — ${s.other.warning}. Скиммеры в магазинах видны только по поведению — после ввода карты; по коду главной страницы их не распознать. На остальных страницах этого шага платёжного действия нет.</li>` : ''}
        <li><b>Подделки брендов, ${s.brand.n} страниц:</b> «опасно» — ${s.brand.danger}: обе страницы, где на сохранённом шаге есть форма карты. Остальные — первые шаги наборов (адрес доставки, вход по паролю, приманка «розыгрыш», проверка Cloudflare перед формой): платёжного объекта на них ещё нет, и помощник правильно молчит.</li>
      </ul>
      <details class="block" style="margin-top:6px"><summary>Все страницы, на которых помощник сработал, и все подделки брендов (${rows.length})</summary>
      <table><thead><tr><th>Сайт</th><th>Что это</th><th>Итог</th><th>Что нашёл помощник</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><a target="_blank" rel="noopener" href="https://urlscan.io/result/${r.uuid}/">${esc(r.domain)}</a><div class="muted small">${esc(r.time)}</div></td><td class="small">${esc(r.why)}</td>
        <td><span class="pill ${V[r.verdict][1]}">${V[r.verdict][0]}</span></td><td class="small">${r.titles.map(esc).join('<br>') || '—'}</td></tr>`).join('')}
      </tbody></table></details>`;
  }
  const real = document.getElementById('real');
  if (real) {
    real.innerHTML = PGCatalog.REAL_SOURCES.map((r) => `<tr><td><a target="_blank" rel="noopener" href="${r.url}">${esc(r.name)}</a></td><td>${esc(r.covers)}</td><td>${esc(r.how)}</td></tr>`).join('');
  }

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
    hidden.style.cssText = 'position:absolute;left:-2000px;top:0;width:1100px;height:800px;border:0';
    document.body.append(hidden);
    let pass = 0, total = 0;
    for (const c of C) {
      for (const p of c.pages) {
        total++;
        box.querySelector('#prog').textContent = 'Проверяется: ' + p.file + ' (' + total + ')';
        const r = await LabRunner.runPage(pageUrl(p), hidden);
        const fired = r.findings.filter((f) => f.severity !== 'info');
        const own = r.findings.some((f) => f.check === c.id && f.severity !== 'info');
        const ok = p.expect === 'ok' ? (r.verdict === 'ok' || r.verdict === 'none') : (r.verdict === p.expect || (p.expect === 'warning' && r.verdict === 'danger')) && own;
        if (ok) pass++;
        const v = PGChecks.VERDICTS[r.verdict];
        tbody.insertAdjacentHTML('beforeend', `<tr><td><a href="#${c.id}">${esc(c.title)}</a></td><td>${esc(p.label)}<div class="muted small">${esc((p.dir || 'pages') + '/' + p.file)}</div></td>
          <td><span class="pill ${EXPECT[p.expect][1]}">${EXPECT[p.expect][0]}</span></td><td><span class="pill ${v.tone === 'none' ? 'info' : v.tone}">${esc(v.title)}</span></td>
          <td class="small">${fired.map((f) => esc(f.title)).join('<br>') || '—'}</td><td>${ok ? '<span class="ok-mark">совпало</span>' : '<span class="bad-mark">не совпало</span>'}</td></tr>`);
      }
    }
    hidden.remove();
    box.querySelector('#prog').innerHTML = `<b id="done">Совпало ${pass} из ${total}.</b> «Совпало» = итог как ожидался и сработала именно своя проверка; для честных страниц — нет ни одного предупреждения (ложной тревоги).`;
    btn.disabled = false;
  });
  if (new URLSearchParams(location.search).has('autorun')) document.getElementById('runAll').click();
})();
