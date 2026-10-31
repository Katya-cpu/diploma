// Раздел 3, вкладка «Исследование схем»: распознавание по типам схем, живой граф схемы, карта t-SNE, владельцы.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (v, d = 0) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (v) => (v < 0.01 ? '<1' : Math.round(v * 100)) + ' %';
  const get = async (path) => { const r = await (await fetch('/api/graph/' + path)).json(); if (r.error) throw new Error(r.error); return r; };

  // Цвета: последовательная шкала одного оттенка для риска; два категориальных слота для карты.
  const SERIES = { found: '#2a78d6', missed: '#eb6834', honest: '#b8bec9' };
  function riskColor(p, thr) {
    const t = Math.min(1, p / Math.max(thr, 1e-6)); // 0 … порог «высокого риска»
    const a = [251, 227, 212], b = [168, 50, 12];
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')';
  }

  // Мини-схемы типов отмывания (иконки 52×40)
  const ICONS = {
    'FAN-IN': [[[6, 6], [6, 20], [6, 34]], [[44, 20]], [[0, 3], [1, 3], [2, 3]]],
    'FAN-OUT': [[[8, 20]], [[46, 6], [46, 20], [46, 34]], [[0, 1], [0, 2], [0, 3]]],
    'CYCLE': [[[26, 5], [44, 30], [8, 30]], [], [[0, 1], [1, 2], [2, 0]]],
    'SCATTER-GATHER': [[[6, 20], [26, 6], [26, 34]], [[46, 20]], [[0, 1], [0, 2], [1, 3], [2, 3]]],
    'GATHER-SCATTER': [[[6, 6], [6, 34], [26, 20]], [[46, 6], [46, 34]], [[0, 2], [1, 2], [2, 3], [2, 4]]],
    'BIPARTITE': [[[8, 8], [8, 32]], [[44, 8], [44, 32]], [[0, 2], [0, 3], [1, 2], [1, 3]]],
    'STACK': [[[6, 8], [6, 32], [26, 8], [26, 32]], [[46, 8], [46, 32]], [[0, 2], [0, 3], [1, 2], [1, 3], [2, 4], [3, 5]]],
    'RANDOM': [[[6, 30], [20, 8], [34, 28]], [[46, 10]], [[0, 1], [1, 2], [2, 3]]],
  };
  function icon(code) {
    const [a, b, e] = ICONS[code] || [[], [], []];
    const pts = a.concat(b);
    return `<svg viewBox="0 0 52 40" width="52" height="40">${e.map(([i, j]) => `<line x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${pts[j][0]}" y2="${pts[j][1]}" stroke="#94a3b8" stroke-width="1.5"/>`).join('')}
      ${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#2a78d6" stroke="#fff" stroke-width="1.5"/>`).join('')}</svg>`;
  }

  let data = null, loaded = false;
  async function open() {
    if (loaded) return;
    try { data = await get('research'); } catch (e) { $('r-stats').innerHTML = '<div class="note warn">' + esc(e.message) + '</div>'; return; }
    loaded = true;
    stats(); types(); chips(); map(); entities();
  }

  function stats() {
    const txns = data.types.reduce((s, t) => s + t.txns, 0);
    const card = (v, t) => `<div class="card stat" style="box-shadow:none"><span class="v">${v}</span><span class="muted small">${t}</span></div>`;
    $('r-stats').innerHTML = card(num(data.patterns.length), 'размеченных операций отмывания') + card('8', 'типов схем') + card(num(txns), 'переводов внутри схем');
  }

  // ---------- 1. распознавание по типам
  function types() {
    $('r-types').innerHTML = data.types.map((t) => `<div class="tbar" title="">
      <span>${icon(t.code)}</span>
      <span><b>${esc(t.name)}</b><small>${esc(t.about)}</small></span>
      <span class="track" data-tip="${esc(t.name)}: найдено ${t.test_recall == null ? '—' : pct(t.test_recall)} из ${t.test_receivers} тестовых получателей; всего схем ${t.attempts}, медианный размер ${num(t.median_size)} счетов"><span class="fill" style="display:block;width:${(t.test_recall || 0) * 100}%"></span></span>
      <span><b>${t.test_recall == null ? '—' : pct(t.test_recall)}</b><small>из ${t.test_receivers}</small></span></div>`).join('') +
      `<p class="note" style="margin-top:14px"><b>Что это значит.</b> Модель уверенно находит схемы, где деньги <b>сходятся на один счёт или расходятся с него</b> («разброс-сбор», «сбор-разброс», веера): у такого счёта необычное окружение, и графовая сеть его «видит». Хуже всего — «стопка» и «двудольная» схема: в них каждый посредник получает 1–2 перевода и внешне не отличается от честного счёта. Это ограничение метода: чтобы ловить такие схемы, нужно анализировать не отдельный счёт, а целую цепочку переводов (подграф) и время между переводами. Для «веера на вход» в тестовой выборке слишком мало счетов, чтобы делать вывод.</p>`;
  }

  // ---------- 2. живой граф схемы
  let current = null, playing = null;
  function chips() {
    $('r-typechips').innerHTML = data.types.map((t) => `<button data-code="${t.code}"><b>${esc(t.name)}</b><small>${data.patterns.filter((p) => p.type === t.code).length} случаев</small></button>`).join('');
    $('r-typechips').onclick = (e) => { const b = e.target.closest('button'); if (b) chooseType(b.dataset.code); };
    $('r-attempt').onchange = () => loadPattern(Number($('r-attempt').value));
    $('r-play').onclick = play;
    chooseType('GATHER-SCATTER');
  }
  function chooseType(code) {
    $('r-typechips').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.code === code));
    const list = data.patterns.filter((p) => p.type === code).sort((a, b) => b.n_accounts - a.n_accounts);
    $('r-attempt').innerHTML = list.map((p) => `<option value="${p.id}">Случай № ${p.id + 1}: ${p.n_accounts} счетов, ${p.n_txns} переводов${p.detail ? ' · ' + esc(p.detail) : ''}</option>`).join('');
    // по умолчанию — случай среднего размера: и узнаваемая форма, и не перегружено
    const pick = list.find((p) => p.n_accounts <= 14) || list[list.length - 1];
    $('r-attempt').value = pick.id;
    loadPattern(pick.id);
  }

  // Силовая укладка Фрухтермана–Рейнгольда: узлы отталкиваются (k²/d), рёбра притягивают (d²/k),
  // «температура» постепенно снижается; в конце картинка вписывается в рамку.
  function layout(nodes, links, W, H) {
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const n = nodes.length, k = Math.sqrt((W * H) / Math.max(n, 1)) * 0.75;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    nodes.forEach((v) => { v.x = W / 2 + (rnd() - 0.5) * W * 0.6; v.y = H / 2 + (rnd() - 0.5) * H * 0.6; });
    const E = links.map((l) => [idx.get(l.s), idx.get(l.t), l.core ? 1.6 : 1]).filter((e) => e[0] != null && e[1] != null && e[0] !== e[1]);
    let temp = W / 8;
    for (let it = 0; it < 300; it++) {
      const dxs = new Float64Array(n), dys = new Float64Array(n);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d = Math.hypot(dx, dy) || 0.1;
        const f = (k * k) / d;
        dxs[i] += (dx / d) * f; dys[i] += (dy / d) * f; dxs[j] -= (dx / d) * f; dys[j] -= (dy / d) * f;
      }
      for (const [a, b, w] of E) {
        const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y, d = Math.hypot(dx, dy) || 0.1;
        const f = ((d * d) / k) * w;
        dxs[a] -= (dx / d) * f; dys[a] -= (dy / d) * f; dxs[b] += (dx / d) * f; dys[b] += (dy / d) * f;
      }
      for (let i = 0; i < n; i++) {
        dxs[i] += (W / 2 - nodes[i].x) * 0.02 * k; dys[i] += (H / 2 - nodes[i].y) * 0.02 * k; // мягкое притяжение к центру
        const d = Math.hypot(dxs[i], dys[i]) || 1, step = Math.min(d, temp);
        nodes[i].x += (dxs[i] / d) * step; nodes[i].y += (dys[i] / d) * step;
      }
      temp *= 0.985;
    }
    const xs = nodes.map((v) => v.x), ys = nodes.map((v) => v.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((W - 60) / Math.max(x1 - x0, 1), (H - 60) / Math.max(y1 - y0, 1));
    nodes.forEach((v) => { v.x = 30 + (v.x - x0) * s + (W - 60 - (x1 - x0) * s) / 2; v.y = 30 + (v.y - y0) * s + (H - 60 - (y1 - y0) * s) / 2; });
  }

  async function loadPattern(id) {
    clearInterval(playing); playing = null;
    const p = await get('pattern?id=' + id);
    current = p;
    const W = 760, H = 520;
    const coreLinks = p.txns.filter((t) => t.s != null && t.t != null).map((t) => ({ s: t.s, t: t.t, core: true }));
    layout(p.nodes, p.links.concat(coreLinks), W, H);
    const pos = new Map(p.nodes.map((n) => [n.id, n]));
    const svg = $('r-graph');
    const line = (a, b, cls, extra = '') => {
      const A = pos.get(a), B = pos.get(b); if (!A || !B) return '';
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, r = (B.role === 'core' ? 12 : 6) + 3;
      return `<line class="${cls}" x1="${A.x}" y1="${A.y}" x2="${B.x - (dx / d) * r}" y2="${B.y - (dy / d) * r}" ${extra}/>`;
    };
    svg.innerHTML = `<defs><marker id="ra" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#a8320c"/></marker>
        <marker id="rg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#cbd5e1"/></marker></defs>
      <g>${p.links.map((l) => line(l.s, l.t, 'nb', 'stroke="#d5dbe5" stroke-width="1" marker-end="url(#rg)"')).join('')}</g>
      <g id="r-txl">${p.txns.map((t, i) => line(t.s, t.t, 'tx', `data-i="${i}" stroke="#a8320c" stroke-width="2.2" marker-end="url(#ra)" opacity="0.9"`)).join('')}</g>
      <g>${p.nodes.map((n) => `<circle data-id="${n.id}" cx="${n.x}" cy="${n.y}" r="${n.role === 'core' ? 12 : 6}" fill="${n.role === 'core' ? riskColor(n.prob, p.threshold) : '#c3c9d4'}"
          stroke="${n.label ? '#0f172a' : '#fff'}" stroke-width="${n.label ? 2.5 : 2}"/>`).join('')}</g>`;
    $('r-log').innerHTML = p.txns.map((t, i) => `<div data-i="${i}" style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(t.time)}</b><br>${num(t.amount, 2)} ${esc(t.currency)}</div>`).join('');
    $('r-clock').textContent = `${p.name}${p.detail ? ' · ' + p.detail : ''}: ${p.nodes.filter((n) => n.role === 'core').length} счетов схемы, ${p.nodes.filter((n) => n.role !== 'core').length} соседей`;
    // подсказка при наведении на счёт
    svg.onmousemove = (e) => {
      const c = e.target.closest('circle'); const tip = $('r-tip');
      if (!c) { tip.hidden = true; return; }
      const n = pos.get(Number(c.dataset.id));
      tip.innerHTML = `<b>${esc(n.account)}</b><br>${n.role === 'core' ? 'счёт схемы' : 'другой контрагент'}<br>Вероятность «дропа»: ${pct(n.prob)}<br>В датасете: ${n.label ? 'получал отмываемые деньги' : 'не получал'}<br>Выборка: ${['—', 'обучающая', 'проверочная', 'тестовая'][n.split]}`;
      const box = svg.getBoundingClientRect();
      tip.style.left = (e.clientX - box.left + 14) + 'px'; tip.style.top = (e.clientY - box.top + 10) + 'px'; tip.hidden = false;
    };
    svg.onmouseleave = () => { $('r-tip').hidden = true; };
  }

  function play() {
    if (!current) return;
    clearInterval(playing);
    const lines = [...$('r-graph').querySelectorAll('line.tx')];
    const rows = [...$('r-log').children];
    lines.forEach((l) => l.setAttribute('opacity', '0')); rows.forEach((r) => { r.style.opacity = 0.3; });
    let i = 0;
    playing = setInterval(() => {
      if (i >= current.txns.length) { clearInterval(playing); playing = null; return; }
      lines.filter((l) => Number(l.dataset.i) === i).forEach((l) => l.setAttribute('opacity', '0.95'));
      if (rows[i]) { rows[i].style.opacity = 1; rows[i].scrollIntoView({ block: 'nearest' }); }
      $('r-clock').textContent = current.txns[i].time + ' · перевод ' + (i + 1) + ' из ' + current.txns.length;
      i++;
    }, 650);
  }

  // ---------- 3. карта t-SNE
  function map() {
    const thr = data.threshold;
    const groups = [['honest', 'Честный получатель', (p) => !p.label], ['found', '«Дроп», модель распознала', (p) => p.label && p.prob >= thr], ['missed', '«Дроп», модель пропустила', (p) => p.label && p.prob < thr]];
    const counts = groups.map(([, , f]) => data.map.filter(f).length);
    $('r-legend').innerHTML = groups.map(([k, name], i) => `<span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="${SERIES[k]}"/></svg> ${name} — ${num(counts[i])}</span>`).join('');
    const cv = $('r-map'), ctx = cv.getContext('2d');
    const draw = () => {
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      for (const [k, , f] of groups) {
        ctx.fillStyle = SERIES[k];
        for (const p of data.map) {
          if (!f(p)) continue;
          ctx.beginPath(); ctx.arc(14 + p.x * (W - 28), 14 + p.y * (H - 28), k === 'honest' ? 2.6 : 4, 0, Math.PI * 2);
          ctx.fill();
          if (k !== 'honest') { ctx.strokeStyle = '#fafbff'; ctx.lineWidth = 1; ctx.stroke(); }
        }
      }
    };
    draw(); window.addEventListener('resize', draw);
    cv.onmousemove = (e) => {
      const r = cv.getBoundingClientRect(), W = cv.clientWidth, H = cv.clientHeight;
      let best = null, bd = 64;
      for (const p of data.map) {
        const dx = 14 + p.x * (W - 28) - (e.clientX - r.left), dy = 14 + p.y * (H - 28) - (e.clientY - r.top), d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      }
      const tip = $('r-maptip');
      if (!best) { tip.hidden = true; return; }
      const TN = Object.fromEntries(data.types.map((t) => [t.code, t.name]));
      tip.innerHTML = `<b>${esc(best.account)}</b><br>${best.label ? '«Дроп»' : 'Честный получатель'}${best.type ? ' · схема «' + esc(TN[best.type]) + '»' : ''}<br>Вероятность по модели: ${pct(best.prob)}`;
      tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 10) + 'px'; tip.hidden = false;
    };
    cv.onmouseleave = () => { $('r-maptip').hidden = true; };
    $('r-mapnote').innerHTML = `<b>Как читать.</b> Синие точки (распознанные «дропы») собираются в отдельные плотные скопления — нейросеть выучила для них своё «место» на карте, далёкое от основной массы честных счетов. Оранжевые (пропущенные) частично лежат рядом с синими — модель почти права, но оценка не дотянула до порога, — а частично внутри серого облака: по своему окружению они неотличимы от честных счетов. Наведите на точку, чтобы увидеть счёт и схему.`;
  }

  // ---------- 4. владельцы
  function entities() {
    const max = Math.max(...data.entities.map((e) => e.rate));
    $('r-entities').innerHTML = data.entities.map((e) => `<div class="tbar" style="grid-template-columns:240px 1fr 120px">
        <span><b>${esc(e.name_ru)}</b><small>${num(e.total)} получателей</small></span>
        <span class="track"><span class="fill" style="display:block;width:${(e.rate / max) * 100}%"></span></span>
        <span><b>${num(e.rate * 100, 2)} %</b><small>${num(e.illicit)} «дропов»</small></span></div>`).join('') +
      `<p class="note" style="margin-top:14px"><b>Честный вывод.</b> Доля «дропов» почти одинакова среди партнёрств, корпораций и ИП (≈1,4 %): генератор IBM назначает роли отмывания случайно, не учитывая тип владельца. В реальных данных банка этот признак, скорее всего, был бы значимым — это ограничение синтетического датасета, о котором стоит сказать в работе.</p>`;
  }

  window.ResearchUI = { open };
  if (location.hash === '#research') open(); // страницу открыли сразу на этой вкладке
})();
