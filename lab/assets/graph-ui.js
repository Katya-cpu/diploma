// Раздел 3: граф транзакций — описание, обучение и результаты моделей, проверка перевода.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (v) => (v < 0.01 ? '<1' : Math.round(v * 100)) + ' %';
  const num = (v, d = 0) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
  const api = async (path, body) => {
    const r = await fetch('/api/graph/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data;
  };
  const COLOR = { rule: '#b8b8b2', logreg: '#8c8c86', boosting: '#b07d00', graphsage: '#1d4e89' };
  const SHORT = { rule: 'правило', logreg: 'логистическая регрессия', boosting: 'градиентный бустинг', graphsage: 'GraphSAGE' };

  // ---------- вкладки ----------
  const tabs = $('tabs');
  function openTab(t) {
    if (!['about', 'model', 'sim', 'research'].includes(t)) t = 'about';
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    ['about', 'model', 'sim', 'research'].forEach((x) => { $('t-' + x).hidden = x !== t; });
    if (t === 'research' && window.ResearchUI) window.ResearchUI.open();
    if (t === 'model') refresh();
    if (t === 'sim') loadExamples();
    history.replaceState(null, '', '#' + t);
  }
  tabs.addEventListener('click', (e) => e.target.dataset.t && openTab(e.target.dataset.t));

  // ---------- рисунок «как устроен граф» ----------
  $('graphPic').innerHTML = `
  <svg viewBox="0 0 900 230" style="width:100%;max-width:900px;display:block;margin:10px auto" role="img" aria-label="Жертвы переводят дропу, он пересылает дальше">
    <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#6b6b6b"/></marker></defs>
    <g font-family="PT Sans, Arial" font-size="13" text-anchor="middle" fill="#1c1c1c">
      ${[40, 90, 140, 190].map((y, k) => `<circle cx="70" cy="${y}" r="16" fill="#fff" stroke="#1c1c1c"/><text x="70" y="${y + 4}">Ж${k + 1}</text><line x1="88" y1="${y}" x2="282" y2="115" stroke="#6b6b6b" marker-end="url(#ar)"/>`).join('')}
      <circle cx="310" cy="115" r="26" fill="#f8eeee" stroke="#a4262c" stroke-width="2"/><text x="310" y="119" font-weight="700">дроп</text>
      <line x1="336" y1="115" x2="452" y2="75" stroke="#6b6b6b" marker-end="url(#ar)"/><line x1="336" y1="115" x2="452" y2="155" stroke="#6b6b6b" marker-end="url(#ar)"/>
      <circle cx="470" cy="70" r="16" fill="#fff" stroke="#1c1c1c"/><text x="470" y="74">С1</text><circle cx="470" cy="160" r="16" fill="#fff" stroke="#1c1c1c"/><text x="470" y="164">С2</text>
      <text x="40" y="222" fill="#6b6b6b" text-anchor="start">жертвы — много разных отправителей</text>
      <text x="310" y="170" fill="#6b6b6b">принимает и сразу</text><text x="310" y="186" fill="#6b6b6b">пересылает дальше</text>
      <text x="470" y="210" fill="#6b6b6b">следующие счета цепочки</text>
      <rect x="590" y="30" width="290" height="170" fill="#f4f4f1" stroke="#d4d4d0"/>
      <g text-anchor="start"><text x="610" y="58" font-weight="700">Что «видит» GraphSAGE у счёта:</text>
      <text x="610" y="84">· свои 17 признаков</text><text x="610" y="108">· среднее по отправителям (слой 1)</text>
      <text x="610" y="132">· среднее по получателям (слой 1)</text><text x="610" y="156">· соседей соседей (слой 2)</text>
      <text x="610" y="182" fill="#6b6b6b">→ вероятность «дроп» от 0 до 1</text></g>
    </g></svg>`;

  // ---------- вкладка «Модель и результаты» ----------
  let polling = null;
  async function refresh() {
    let s;
    try { s = await api('status'); } catch (e) { $('statusCards').innerHTML = '<div class="note warn">' + esc(e.message) + '</div>'; return; }
    const m = s.model;
    const card = (title, ok, text) => `<div class="card stat"><span class="muted small">${title}</span><span class="v">${ok ? 'готово' : 'нет'}</span><span class="muted small">${text}</span></div>`;
    $('statusCards').innerHTML =
      card('Датасет IBM AMLworld', s.dataset.exists, s.dataset.exists ? 'HI-Small_Trans.csv, ' + s.dataset.size_mb + ' МБ' : 'не скачан — нажмите «1. Скачать датасет»') +
      card('Граф', s.prepared, s.prepared && m ? num(m.dataset.accounts) + ' счетов, ' + num(m.dataset.edges) + ' связей' : (s.prepared ? 'построен' : 'не построен')) +
      card('Модель', !!m, m ? 'обучена ' + m.trained_at + ' за ' + Math.round(m.seconds / 60) + ' мин' : 'не обучена');
    const p = (m && m.params) || s.defaults;
    for (const k of Object.keys(s.defaults)) if (!$('p-' + k).value) $('p-' + k).value = p[k];
    showResults(m);
    if (s.explained) api('explain').then((x) => showExplain(x, m)).catch((e) => { $('explain').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
    else $('explain').innerHTML = '<p class="muted">Разбор модели появится после обучения (или нажмите «4. Разбор модели»).</p>';
    pollJob();
  }

  function hbars(rows, max) {
    return rows.map((r) => `<div class="hbar"><span>${esc(r.t)}</span><span class="track"><span class="fill${r.accent ? ' accent' : ''}" style="width:${Math.max(0.5, (r.v / max) * 100)}%"></span></span><b>${r.label}</b></div>`).join('');
  }

  function showResults(m) {
    const box = $('results');
    if (!m) { box.innerHTML = '<p class="muted">Результаты появятся после обучения.</p>'; return; }
    const base = m.dataset.illicit_recipients / m.dataset.recipients;
    const order = ['rule', 'logreg', 'boosting', 'graphsage'];
    const best = Math.max(...order.map((k) => m.models[k].pr_auc));
    box.innerHTML = `<h2 style="margin-top:0">1. Сравнение моделей на тестовой выборке</h2>
      <p class="muted">Тест: ${num(m.models.graphsage.total)} счетов-получателей, из них дропов ${num(m.models.graphsage.positives)}. Случайное угадывание дало бы PR-AUC ≈ ${num(base, 3)}.</p>
      ${hbars(order.map((k) => ({ t: m.models[k].title, v: m.models[k].pr_auc, label: num(m.models[k].pr_auc, 3), accent: k === 'graphsage' })), best)}
      <table class="cmp" style="margin-top:16px"><thead><tr><th>Модель</th><th class="num">PR-AUC</th><th class="num">ROC-AUC</th><th class="num">Полнота при 1 % ложных тревог</th><th class="num">Точность топ-100</th><th class="num">Лучший F1</th></tr></thead><tbody>
      ${order.map((k) => { const r = m.models[k]; return `<tr><td>${esc(r.title)}</td><td class="num"><b>${num(r.pr_auc, 3)}</b></td><td class="num">${num(r.roc_auc, 3)}</td><td class="num">${num(r.recall_at_1fpr * 100, 1)} %</td><td class="num">${num(r.precision_top100 * 100, 0)} %</td><td class="num">${num(r.best_f1, 3)}</td></tr>`; }).join('')}
      </tbody></table>
      <p class="note" style="margin-top:16px"><b>Вывод.</b> Модели, которые смотрят только на сам счёт (правило, логистическая регрессия), почти не отличают дропа от честного получателя. Как только модель видит окружение счёта (бустинг с признаками соседей, GraphSAGE), качество растёт в разы. Риск получателя определяется прежде всего его связями — это аргумент за графовый подход. Что означает каждая метрика — раздел 19 страницы <a href="/graphsage.html#s14">«Данные и модели»</a>.</p>`;
  }

  function showExplain(x, m) {
    if (!m) return;
    const W = 720, H = 330, P = { l: 56, r: 200, t: 14, b: 44 };
    const X = (r) => P.l + r * (W - P.l - P.r), Y = (p) => H - P.b - p * (H - P.t - P.b);
    let pr = `<line x1="${P.l}" y1="${H - P.b}" x2="${W - P.r}" y2="${H - P.b}" stroke="#999"/><line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H - P.b}" stroke="#999"/>`;
    for (const t of [0, 0.5, 1]) pr += `<text x="${X(t)}" y="${H - P.b + 16}" font-size="12" text-anchor="middle" fill="#6b6b6b">${num(t, 1)}</text><text x="${P.l - 8}" y="${Y(t) + 4}" font-size="12" text-anchor="end" fill="#6b6b6b">${num(t, 1)}</text>`;
    pr += `<text x="${(P.l + W - P.r) / 2}" y="${H - 8}" font-size="13" text-anchor="middle">полнота — какую долю дропов нашли</text><text transform="translate(14 ${(P.t + H - P.b) / 2}) rotate(-90)" font-size="13" text-anchor="middle">точность</text>`;
    let ly = 24;
    for (const k of ['rule', 'logreg', 'boosting', 'graphsage']) {
      pr += `<polyline fill="none" stroke="${COLOR[k]}" stroke-width="${k === 'graphsage' ? 3 : 2}" points="${x.curves[k].map(([r, p]) => X(r) + ',' + Y(p)).join(' ')}"/>`;
      pr += `<line x1="${W - P.r + 14}" y1="${ly}" x2="${W - P.r + 38}" y2="${ly}" stroke="${COLOR[k]}" stroke-width="3"/><text x="${W - P.r + 44}" y="${ly + 4}" font-size="13">${SHORT[k]}</text>`;
      ly += 22;
    }
    const conf = (title, c) => {
      const drops = c.tp + c.fn, honest = c.fp + c.tn;
      return `<div><b>${title}</b> (вероятность ≥ ${pct(c.threshold)})<table style="margin-top:6px"><tbody>
        <tr><td>найдено дропов</td><td><b>${num(c.tp)}</b> из ${num(drops)} (${pct(c.tp / drops)})</td></tr>
        <tr><td>пропущено дропов</td><td>${num(c.fn)}</td></tr>
        <tr><td>ложные тревоги</td><td><b>${num(c.fp)}</b> из ${num(honest)} честных (${num(c.fp / honest * 100, 1)} %)</td></tr>
        <tr><td>точность тревог</td><td>${pct(c.tp / (c.tp + c.fp))} — столько поднятых тревог действительно дропы</td></tr></tbody></table></div>`;
    };
    const c = m.curve, maxE = c[c.length - 1].epoch, maxL = Math.max(...c.map((d) => d.loss)), maxA = Math.max(...c.map((d) => d.val_pr_auc)) * 1.15;
    const cx = (e) => 50 + (e / maxE) * 610, cyL = (v) => 200 - (v / maxL) * 170, cyA = (v) => 200 - (v / maxA) * 170;
    const curve = `<svg viewBox="0 0 720 240" style="width:100%"><g font-size="13" fill="#6b6b6b"><line x1="50" y1="200" x2="660" y2="200" stroke="#999"/>
      <polyline fill="none" stroke="#999" stroke-width="2" stroke-dasharray="5 4" points="${c.map((d) => cx(d.epoch) + ',' + cyL(d.loss)).join(' ')}"/>
      <polyline fill="none" stroke="#1d4e89" stroke-width="2.5" points="${c.map((d) => cx(d.epoch) + ',' + cyA(d.val_pr_auc)).join(' ')}"/>
      <text x="355" y="228" text-anchor="middle">эпоха (из ${maxE})</text>
      <text x="${cx(c[2].epoch) + 6}" y="${cyL(c[2].loss) - 8}">ошибка на обучении (пунктир): ${num(c[0].loss, 2)} → ${num(c[c.length - 1].loss, 2)}</text>
      <text x="660" y="${cyA(Math.max(...c.map((d) => d.val_pr_auc))) - 10}" text-anchor="end" fill="#1d4e89">PR-AUC на проверке: ${num(c[0].val_pr_auc, 2)} → ${num(Math.max(...c.map((d) => d.val_pr_auc)), 2)}</text></g></svg>`;
    $('explain').innerHTML = `
      <h2 style="margin-top:0">2. Кривые «точность–полнота»</h2>
      <p class="muted">Каждая точка — один возможный порог. Чем выше и правее кривая, тем лучше; площадь под ней и есть PR-AUC.</p>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:820px">${pr}</svg>
      <h2>3. Что происходит на порогах GraphSAGE</h2>
      <div class="grid2">${conf('Порог «высокий риск»', x.at_threshold.high)}${conf('Порог «повышенный риск»', x.at_threshold.elevated)}</div>
      <h2>4. Что даёт граф: «закрываем сети глаза»</h2>
      <p class="muted">Та же обученная сеть, но вместо среднего по отправителям и/или получателям на вход слоёв подаются нули. Сеть не переобучается.</p>
      ${hbars(x.ablation.map((a, i) => ({ t: a.title, v: a.pr_auc, label: num(a.pr_auc, 3), accent: i === 0 })), x.ablation[0].pr_auc)}
      <p class="note">Без соседей сеть почти бесполезна (PR-AUC ${num(x.ablation[3].pr_auc, 3)} при случайном ${num(x.base_rate, 3)}), а больше всего информации дают <b>отправители</b> — от кого приходят деньги. Это совпадает со смыслом схемы «дроп».</p>
      <h2>5. Какие признаки важнее</h2>
      <p class="muted">Падение PR-AUC, если значения признака перемешать между всеми счетами (признак превращается в шум).</p>
      ${hbars(x.importance.slice(0, 10).map((q) => ({ t: q.name, v: Math.max(0, q.drop), label: '−' + num(q.drop, 3) })), x.importance[0].drop)}
      <h2>6. Как шло обучение</h2>
      ${curve}
      <p class="muted small">Параметры: ${Object.entries(m.params).map(([k, v]) => k + ' = ' + v).join(', ')}. В сети ${num(x.params_total)} обучаемых чисел (весов). Подробно — в разделах 13–14 страницы <a href="/graphsage.html#s8">«Данные и модели»</a>.</p>`;
  }

  async function pollJob() {
    clearTimeout(polling);
    const j = await api('job');
    if (j.kind) $('log').textContent = j.kind + (j.running ? ' — выполняется…' : ' — завершено') + '\n' + j.log.join('\n') + (j.error ? '\nОШИБКА: ' + j.error : '');
    $('log').scrollTop = 1e9;
    ['b-download', 'b-prepare', 'b-train', 'b-explain', 'b-research'].forEach((b) => { $(b).disabled = j.running; });
    if (j.running) polling = setTimeout(pollJob, 1500);
    else if (j.kind && !j.error && pollJob.wasRunning) { pollJob.wasRunning = false; refresh(); }
    if (j.running) pollJob.wasRunning = true;
  }
  async function start(path, body) {
    try { await api(path, body || {}); pollJob(); } catch (e) { $('log').textContent = e.message; }
  }
  $('b-download').onclick = () => start('download');
  $('b-prepare').onclick = () => start('prepare');
  $('b-explain').onclick = () => start('explain');
  $('b-research').onclick = () => start('research');
  $('b-train').onclick = () => {
    const params = {};
    ['epochs', 'hidden', 'layers', 'lr', 'dropout', 'seed'].forEach((k) => { params[k] = Number($('p-' + k).value); });
    start('train', params);
  };

  // ---------- вкладка «Проверка перевода» ----------
  let examplesLoaded = false;
  async function loadExamples() {
    if (examplesLoaded) return;
    try {
      const ex = await api('examples');
      $('examples').innerHTML = ex.items.map((e) => `<button data-acc="${esc(e.account)}"><b>${esc(e.account)}</b><small>${esc(e.group)}</small></button>`).join('');
      examplesLoaded = true;
      if (new URLSearchParams(location.search).has('demo')) $('examples').querySelector('button').click();
    } catch (e) { $('examples').innerHTML = '<div class="note warn">' + esc(e.message) + '</div>'; }
  }
  $('examples').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $('examples').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $('s-recipient').value = b.dataset.acc; simulate();
  });
  $('s-go').onclick = simulate;

  const DEC = {
    high: 'Высокий риск: перевод стоит приостановить', elevated: 'Повышенный риск: нужна дополнительная проверка',
    low: 'Низкий риск по истории счёта', unknown: 'Недостаточно данных',
  };
  async function simulate() {
    const box = $('simResult');
    box.innerHTML = '<p class="muted">Проверка… (при первой проверке модель считает оценки без соседей — несколько секунд)</p>';
    let r;
    try { r = await api('check', { recipient: $('s-recipient').value, sender: $('s-sender').value, amount: Number($('s-amount').value) }); } catch (e) { box.innerHTML = '<div class="note warn">' + esc(e.message) + '</div>'; return; }
    let html = `<div class="decision ${r.decision}"><div class="big">${DEC[r.decision]}</div><div class="small">Получатель ${esc(r.recipient)}</div></div>`;
    if (!r.known) { box.innerHTML = html + '<p>' + esc(r.message) + '</p>'; return; }
    const pos = (v) => Math.min(100, Math.max(0, Math.sqrt(v) * 100)); // корень растягивает малые значения
    const level = (p) => (p >= r.thresholds.high ? '<span class="pill danger">высокий</span>' : p >= r.thresholds.elevated ? '<span class="pill warning">повышенный</span>' : '<span class="pill ok">низкий</span>');
    html += `<h3>Вероятность, что счёт — дроп: ${pct(r.score)}</h3>
      <p class="muted small">Оценка GraphSAGE, откалиброванная на проверочной выборке: из 100 счетов с такой оценкой примерно ${num(r.score * 100, 0)} — дропы.</p>
      <div class="scale"><div class="mark" style="left:calc(${pos(r.score)}% - 1px)"></div>
        <span class="thr" style="left:${pos(r.thresholds.elevated)}%">повышенный от ${pct(r.thresholds.elevated)}</span>
        <span class="thr" style="left:${pos(r.thresholds.high)}%;top:-20px">высокий от ${pct(r.thresholds.high)}</span></div>`;
    if (r.what_if) {
      html += `<h3>За счёт чего такая оценка</h3>
        <p class="muted small">Та же сеть, но без части соседей. Если без соседей оценка резко падает — подозрительным счёт делает его окружение, а не он сам.</p>
        <table><thead><tr><th>Что видит сеть</th><th>Вероятность</th><th>Уровень</th></tr></thead><tbody>
        ${[['Всё: счёт + отправители + получатели', r.score], ['Без получателей', r.what_if.no_receivers], ['Без отправителей', r.what_if.no_senders], ['Только сам счёт', r.what_if.no_neighbors]]
          .map(([t, p]) => `<tr><td>${t}</td><td><b>${num(p * 100, 1)} %</b></td><td>${level(p)}</td></tr>`).join('')}</tbody></table>`;
    }
    const notes = [];
    if (r.first_transfer !== undefined) notes.push(r.first_transfer ? 'Отправитель раньше никогда не переводил этому получателю.' : 'Отправитель уже переводил этому получателю раньше.');
    if (r.amount_ratio) notes.push(r.amount_ratio >= 1
      ? 'Сумма перевода в ' + num(r.amount_ratio, 1) + ' раза больше среднего входящего перевода на этот счёт ($' + num(r.avg_incoming, 0) + ').'
      : 'Сумма перевода — ' + num(r.amount_ratio * 100, 0) + ' % от среднего входящего перевода на этот счёт ($' + num(r.avg_incoming, 0) + ').');
    notes.push('У счёта ' + num(r.n_senders) + ' отправителей и ' + num(r.n_receivers) + ' получателей в истории.');
    html += '<ul>' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>';
    html += '<h3>Окружение счёта в графе</h3>' + egoSvg(r);
    html += `<h3>Чем счёт отличается от типичного честного получателя</h3><table><thead><tr><th>Признак</th><th>Этот счёт</th><th>Типичный (медиана)</th></tr></thead><tbody>
      ${r.explain.map((x) => `<tr><td>${esc(x.name)}</td><td><b>${num(x.value, x.value < 10 && !Number.isInteger(x.value) ? 2 : 0)}</b></td><td>${num(x.typical, x.typical < 10 && !Number.isInteger(x.typical) ? 2 : 0)}</td></tr>`).join('')}</tbody></table>`;
    html += `<div class="note" style="margin-top:14px"><b>Для администратора:</b> счёт из ${esc(r.in_split)} выборки; в датасете он ${r.true_label ? '<b>действительно дроп</b> (получал отмываемые деньги)' : 'честный'}. Сотрудник банка этой метки не видит.</div>`;
    box.innerHTML = html;
  }

  function egoSvg(r) {
    const W = 560, H = 60 + Math.max(r.senders.length, r.receivers.length, 1) * 40;
    const color = (s) => (s >= r.thresholds.high ? '#a4262c' : s >= r.thresholds.elevated ? '#b07d00' : '#2e6b3f');
    const cy = H / 2;
    const node = (x, y, n, anchor) => `<circle cx="${x}" cy="${y}" r="8" fill="${color(n.score)}"/><text x="${anchor === 'end' ? x - 14 : x + 14}" y="${y + 4}" text-anchor="${anchor}">${esc(n.account)} · ${pct(n.score)}${n.label ? ' · дроп' : ''}</text>`;
    const side = (list, x, anchor) => list.map((n, k) => {
      const y = 30 + k * 40 + (H - 60 - (list.length - 1) * 40) / 2;
      const line = anchor === 'end' ? `<line x1="${x + 10}" y1="${y}" x2="${W / 2 - 24}" y2="${cy}" stroke="#bbb" marker-end="url(#a2)"/>` : `<line x1="${W / 2 + 24}" y1="${cy}" x2="${x - 12}" y2="${y}" stroke="#bbb" marker-end="url(#a2)"/>`;
      return line + node(x, y, n, anchor);
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%"><defs><marker id="a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#bbb"/></marker></defs>
      <g font-size="11" font-family="PT Sans, Arial" fill="#3a3a3a">
      <text x="20" y="16" fill="#6b6b6b">кто переводил (${r.n_senders})</text><text x="${W - 20}" y="16" text-anchor="end" fill="#6b6b6b">кому переводил (${r.n_receivers})</text>
      ${side(r.senders, 150, 'end')}${side(r.receivers, W - 150, 'start')}
      <circle cx="${W / 2}" cy="${cy}" r="18" fill="${color(r.score)}" stroke="#1c1c1c" stroke-width="2"/><text x="${W / 2}" y="${cy + 34}" text-anchor="middle" font-weight="700">получатель</text></g></svg>`;
  }

  window.addEventListener('hashchange', () => openTab((location.hash || '#about').slice(1)));
  openTab((location.hash || '#about').slice(1));
})();
