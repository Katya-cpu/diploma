// Раздел 3: граф транзакций — описание, обучение модели, имитация перевода.
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

  // ---------- вкладки ----------
  const tabs = $('tabs');
  function openTab(t) {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    ['about', 'model', 'sim'].forEach((x) => { $('t-' + x).hidden = x !== t; });
    if (t === 'model') refresh();
    if (t === 'sim') loadExamples();
    history.replaceState(null, '', '#' + t);
  }
  tabs.addEventListener('click', (e) => e.target.dataset.t && openTab(e.target.dataset.t));

  // ---------- картинка «как устроен граф» ----------
  $('graphPic').innerHTML = `
  <svg viewBox="0 0 900 230" style="width:100%;max-width:900px;display:block;margin:10px auto">
    <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#94a3b8"/></marker></defs>
    <g font-family="system-ui" font-size="13" text-anchor="middle">
      ${[40, 90, 140, 190].map((y, k) => `<circle cx="70" cy="${y}" r="16" fill="#e0e7ff"/><text x="70" y="${y + 4}">Ж${k + 1}</text><line x1="88" y1="${y}" x2="292" y2="115" stroke="#94a3b8" marker-end="url(#ar)"/>`).join('')}
      <circle cx="310" cy="115" r="26" fill="#fee4e2" stroke="#d92d20" stroke-width="2"/><text x="310" y="119" font-weight="700">Дроп</text>
      <line x1="336" y1="115" x2="452" y2="75" stroke="#94a3b8" marker-end="url(#ar)"/><line x1="336" y1="115" x2="452" y2="155" stroke="#94a3b8" marker-end="url(#ar)"/>
      <circle cx="470" cy="70" r="16" fill="#fef0c7"/><text x="470" y="74">С1</text><circle cx="470" cy="160" r="16" fill="#fef0c7"/><text x="470" y="164">С2</text>
      <text x="40" y="222" fill="#64748b" text-anchor="start">жертвы (много разных отправителей)</text>
      <text x="310" y="170" fill="#64748b">принимает и сразу</text><text x="310" y="186" fill="#64748b">пересылает дальше</text>
      <text x="470" y="210" fill="#64748b">следующие счета цепочки</text>
      <rect x="590" y="30" width="290" height="170" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
      <g text-anchor="start" font-size="13"><text x="610" y="58" font-weight="700">Что «видит» GraphSAGE у счёта:</text>
      <text x="610" y="84">• свои 17 признаков</text><text x="610" y="108">• среднее по отправителям (слой 1)</text>
      <text x="610" y="132">• среднее по получателям (слой 1)</text><text x="610" y="156">• соседей соседей (слой 2)</text>
      <text x="610" y="182" fill="#64748b">→ оценка риска 0…1</text></g>
    </g></svg>`;

  // ---------- вкладка «Модель» ----------
  let polling = null;
  async function refresh() {
    let s;
    try { s = await api('status'); } catch (e) { $('statusCards').innerHTML = '<div class="note warn">' + esc(e.message) + '</div>'; return; }
    const m = s.model;
    const card = (title, ok, text) => `<div class="card stat"><span class="eyebrow">${title}</span><span class="v">${ok ? '✓' : '—'}</span><span class="muted small">${text}</span></div>`;
    $('statusCards').innerHTML =
      card('Датасет IBM AMLworld', s.dataset.exists, s.dataset.exists ? 'HI-Small_Trans.csv, ' + s.dataset.size_mb + ' МБ' : 'Не скачан — нажмите «Скачать датасет»') +
      card('Граф', s.prepared, s.prepared && m ? num(m.dataset.accounts) + ' счетов, ' + num(m.dataset.edges) + ' связей' : (s.prepared ? 'Построен' : 'Не построен')) +
      card('Модель', !!m, m ? 'Обучена ' + m.trained_at + ' за ' + m.seconds + ' с' : 'Не обучена');
    const p = (m && m.params) || s.defaults;
    for (const k of Object.keys(s.defaults)) if (!$('p-' + k).value) $('p-' + k).value = p[k];
    showResults(m);
    pollJob();
  }

  function showResults(m) {
    const box = $('results');
    if (!m) { box.innerHTML = '<p class="muted">Результаты появятся после обучения.</p>'; return; }
    const base = m.dataset.illicit_recipients / m.dataset.recipients;
    const order = ['rule', 'logreg', 'boosting', 'graphsage'];
    const best = Math.max(...order.map((k) => m.models[k].pr_auc));
    box.innerHTML = `<h2 style="margin-top:0">Результаты на тестовой выборке</h2>
      <p class="muted">Тест: ${num(m.models.graphsage.total)} счетов-получателей, из них «дропов» ${num(m.models.graphsage.positives)}. Случайное угадывание дало бы PR-AUC ≈ ${num(base, 3)}.</p>
      <div class="bars">${order.map((k) => `<div class="row"><span>${esc(m.models[k].title)}</span>
        <div class="track"><div class="fill" style="width:${(m.models[k].pr_auc / Math.max(best, 0.01)) * 100}%;background:${k === 'graphsage' ? '#079455' : '#2f5bff'}"></div></div><b>${num(m.models[k].pr_auc, 3)}</b></div>`).join('')}</div>
      <table style="margin-top:16px"><thead><tr><th>Модель</th><th>PR-AUC</th><th>ROC-AUC</th><th>Полнота при 1 % ложных тревог</th><th>Точность топ-100</th><th>Лучший F1</th></tr></thead><tbody>
      ${order.map((k) => { const r = m.models[k]; return `<tr><td>${esc(r.title)}</td><td><b>${num(r.pr_auc, 3)}</b></td><td>${num(r.roc_auc, 3)}</td><td>${num(r.recall_at_1fpr * 100, 1)} %</td><td>${num(r.precision_top100 * 100, 0)} %</td><td>${num(r.best_f1, 3)}</td></tr>`; }).join('')}
      </tbody></table>
      <div class="grid2" style="margin-top:20px">
        <div><h3>Обучение GraphSAGE</h3>${curveSvg(m.curve)}</div>
        <div><h3>Пороги решения (подобраны на проверочной выборке)</h3>
          <p><span class="pill danger">высокий риск</span> вероятность «дропа» ≥ ${pct(m.thresholds.high)}</p>
          <p><span class="pill warning">повышенный риск</span> вероятность ≥ ${pct(m.thresholds.elevated)}</p>
          <p><span class="pill ok">низкий риск</span> ниже</p>
          <p class="muted small">Параметры: ${Object.entries(m.params).map(([k, v]) => k + '=' + v).join(', ')}</p></div>
      </div>
      <div class="note" style="margin-top:16px"><b>Вывод для диплома.</b> Модели, которые смотрят только на сам счёт, почти не отличают «дропа» от честного получателя. Как только модель видит окружение счёта в графе (бустинг с признаками соседей, GraphSAGE), качество вырастает в разы. Значит, риск получателя определяется прежде всего его связями — это и есть аргумент за графовый подход.</div>`;
  }

  function curveSvg(curve) {
    if (!curve || !curve.length) return '';
    const W = 520, H = 200, P = 36;
    const maxE = curve[curve.length - 1].epoch, maxY = Math.max(...curve.map((c) => c.val_pr_auc)) * 1.1;
    const pts = curve.map((c) => [P + (c.epoch / maxE) * (W - 2 * P), H - P - (c.val_pr_auc / maxY) * (H - 2 * P)]);
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%"><g font-size="11" fill="#64748b" font-family="system-ui">
      <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#e2e8f0"/><line x1="${P}" y1="${P / 2}" x2="${P}" y2="${H - P}" stroke="#e2e8f0"/>
      <text x="${W / 2}" y="${H - 6}" text-anchor="middle">эпоха (до ${maxE})</text><text x="10" y="${P / 2 + 4}">${num(maxY, 2)}</text>
      <text x="${P + 6}" y="${P / 2 + 12}">PR-AUC на проверочной выборке</text></g>
      <polyline fill="none" stroke="#079455" stroke-width="2.5" points="${pts.map((p) => p.join(',')).join(' ')}"/></svg>`;
  }

  async function pollJob() {
    clearTimeout(polling);
    const j = await api('job');
    if (j.kind) $('log').textContent = j.kind + (j.running ? ' — выполняется…' : ' — завершено') + '\n' + j.log.join('\n') + (j.error ? '\nОШИБКА: ' + j.error : '');
    $('log').scrollTop = 1e9;
    ['b-download', 'b-prepare', 'b-train'].forEach((b) => { $(b).disabled = j.running; });
    if (j.running) polling = setTimeout(pollJob, 1500);
    else if (j.kind && !j.error && pollJob.wasRunning) { pollJob.wasRunning = false; refresh(); }
    if (j.running) pollJob.wasRunning = true;
  }
  async function start(path, body) {
    try { await api(path, body || {}); pollJob(); } catch (e) { $('log').textContent = e.message; }
  }
  $('b-download').onclick = () => start('download');
  $('b-prepare').onclick = () => start('prepare');
  $('b-train').onclick = () => {
    const params = {};
    ['epochs', 'hidden', 'layers', 'lr', 'dropout', 'seed'].forEach((k) => { params[k] = Number($('p-' + k).value); });
    start('train', params);
  };

  // ---------- вкладка «Имитация перевода» ----------
  let examplesLoaded = false;
  async function loadExamples() {
    if (examplesLoaded) return;
    try {
      const ex = await api('examples');
      $('examples').innerHTML = ex.items.map((e) => `<button data-acc="${esc(e.account)}"><b>${esc(e.account)}</b><small>${esc(e.group)}</small></button>`).join('');
      examplesLoaded = true;
    } catch (e) { $('examples').innerHTML = '<div class="note warn">' + esc(e.message) + '</div>'; }
  }
  $('examples').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $('s-recipient').value = b.dataset.acc; simulate();
  });
  $('s-go').onclick = simulate;

  const DEC = {
    high: ['Высокий риск: перевод стоит приостановить', '!'], elevated: ['Повышенный риск: нужна дополнительная проверка', '?'],
    low: ['Низкий риск по истории счёта', '✓'], unknown: ['Недостаточно данных', '–'],
  };
  async function simulate() {
    const box = $('simResult');
    box.innerHTML = '<p class="muted">Проверка…</p>';
    let r;
    try { r = await api('check', { recipient: $('s-recipient').value, sender: $('s-sender').value, amount: Number($('s-amount').value) }); } catch (e) { box.innerHTML = '<div class="note warn">' + esc(e.message) + '</div>'; return; }
    const d = DEC[r.decision];
    let html = `<div class="decision ${r.decision}"><div class="big">${d[1]}</div><div><div class="big" style="font-size:18px">${d[0]}</div><div class="small">Получатель ${esc(r.recipient)}</div></div></div>`;
    if (!r.known) { box.innerHTML = html + '<p>' + esc(r.message) + '</p>'; return; }
    const pos = (v) => Math.min(100, Math.max(0, Math.sqrt(v) * 100)); // корень растягивает малые значения
    html += `<h3>Вероятность, что счёт — «дроп»: ${pct(r.score)}</h3>
      <p class="muted small">Оценка графовой нейросети GraphSAGE, откалиброванная на проверочной выборке: из 100 счетов с такой оценкой примерно ${num(r.score * 100, 0)} — «дропы».</p>
      <div class="scale"><div class="mark" style="left:calc(${pos(r.score)}% - 2px)"></div>
        <span class="thr" style="left:${pos(r.thresholds.elevated)}%">повышенный от ${pct(r.thresholds.elevated)}</span>
        <span class="thr" style="left:${pos(r.thresholds.high)}%;top:-20px">высокий от ${pct(r.thresholds.high)}</span></div>`;
    const notes = [];
    if (r.first_transfer !== undefined) notes.push(r.first_transfer ? 'Отправитель раньше никогда не переводил этому получателю.' : 'Отправитель уже переводил этому получателю раньше.');
    if (r.amount_ratio) notes.push(r.amount_ratio >= 1
      ? 'Сумма перевода в ' + num(r.amount_ratio, 1) + ' раза больше среднего входящего перевода на этот счёт ($' + num(r.avg_incoming, 0) + ').'
      : 'Сумма перевода — ' + num(r.amount_ratio * 100, 0) + ' % от среднего входящего перевода на этот счёт ($' + num(r.avg_incoming, 0) + ').');
    notes.push('У счёта ' + num(r.n_senders) + ' отправителей и ' + num(r.n_receivers) + ' получателей в истории.');
    html += '<ul>' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>';
    html += '<h3>Окружение счёта в графе</h3>' + egoSvg(r);
    html += `<h3>Чем счёт отличается от типичного честного получателя</h3><table><thead><tr><th>Признак</th><th>Этот счёт</th><th>Типичный (медиана)</th></tr></thead><tbody>
      ${r.explain.map((x) => `<tr><td>${esc(x.name)}</td><td><b>${num(x.value, x.value < 10 ? 2 : 0)}</b></td><td>${num(x.typical, x.typical < 10 ? 2 : 0)}</td></tr>`).join('')}</tbody></table>`;
    html += `<div class="note" style="margin-top:14px"><b>Для администратора:</b> счёт из ${esc(r.in_split)} выборки; в датасете он ${r.true_label ? '<b>действительно «дроп»</b> (получал отмываемые деньги)' : 'честный'}. Пользователь банка этой метки не видит.</div>`;
    box.innerHTML = html;
  }

  function egoSvg(r) {
    const W = 560, H = 60 + Math.max(r.senders.length, r.receivers.length, 1) * 40;
    const color = (s) => s >= r.thresholds.high ? '#d92d20' : s >= r.thresholds.elevated ? '#f79009' : '#12b76a';
    const cy = H / 2;
    const node = (x, y, n, anchor) => `<circle cx="${x}" cy="${y}" r="9" fill="${color(n.score)}"/><text x="${anchor === 'end' ? x - 14 : x + 14}" y="${y + 4}" text-anchor="${anchor}">${esc(n.account)} · ${pct(n.score)}</text>`;
    const side = (list, x, anchor) => list.map((n, k) => {
      const y = 30 + k * 40 + (H - 60 - (list.length - 1) * 40) / 2;
      const line = anchor === 'end' ? `<line x1="${x + 10}" y1="${y}" x2="${W / 2 - 24}" y2="${cy}" stroke="#cbd5e1" marker-end="url(#a2)"/>` : `<line x1="${W / 2 + 24}" y1="${cy}" x2="${x - 12}" y2="${y}" stroke="#cbd5e1" marker-end="url(#a2)"/>`;
      return line + node(x, y, n, anchor);
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%"><defs><marker id="a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#cbd5e1"/></marker></defs>
      <g font-size="11" font-family="system-ui" fill="#334155">
      <text x="20" y="16" fill="#64748b">кто переводил (${r.n_senders})</text><text x="${W - 20}" y="16" text-anchor="end" fill="#64748b">кому переводил (${r.n_receivers})</text>
      ${side(r.senders, 150, 'end')}${side(r.receivers, W - 150, 'start')}
      <circle cx="${W / 2}" cy="${cy}" r="20" fill="${color(r.score)}" stroke="#0f172a" stroke-width="2"/><text x="${W / 2}" y="${cy + 36}" text-anchor="middle" font-weight="700">получатель</text></g></svg>`;
  }

  window.addEventListener('hashchange', () => openTab((location.hash || '#about').slice(1)));
  openTab((location.hash || '#about').slice(1));
})();
