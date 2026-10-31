/*
 * Контент-скрипт: запускает анализатор (core/checks.js) на открытой странице
 * и показывает панель с результатом в правом нижнем углу.
 * Значения полей, которые вводит пользователь, не читаются и не сохраняются.
 */
(() => {
  'use strict';
  if (window.top !== window) return;                          // только основная страница, не фреймы
  if (document.querySelector('meta[name="pg-lab-ui"]')) return; // интерфейс самой лаборатории не проверяем
  const api = typeof browser !== 'undefined' ? browser : chrome;

  let report = null, timer = null, hiddenKey = '', signature = '';
  const sensors = PGWatch.start(document, (state) => {
    if (state.cardInputAt && !state.cardNotified) {
      state.cardNotified = true;
      api.runtime.sendMessage({ type: 'card-input' });
      schedule(2500); // дать скрипту страницы время что-нибудь отправить
    }
    const sig = state.changes.length + ':' + state.addedCardFields;
    if (sig !== signature) { signature = sig; schedule(600); }
  });

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms); }

  async function run() {
    try { sensors.network = (await api.runtime.sendMessage({ type: 'network' })) || []; } catch (e) { sensors.network = []; }
    report = await PGChecks.inspect(document, sensors);
    report.url = location.href;
    const slim = JSON.parse(JSON.stringify(report));
    api.runtime.sendMessage({ type: 'report', report: slim }).catch(() => {});
    const { trusted = {} } = await api.storage.local.get('trusted');
    render(report, !!trusted[location.origin]);
  }

  api.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'rescan') { hiddenKey = ''; run(); }
  });

  // ---------------- Панель ----------------
  const COLORS = { danger: '#d92d20', warning: '#dc6803', ok: '#12b76a', none: '#667085' };
  let host = null;

  function render(r, trusted) {
    const serious = r.findings.filter((f) => f.severity === 'danger' || f.severity === 'warning');
    // Доверенный сайт: обычные сведения не показываем, но предупреждения об угрозах — всегда.
    const show = serious.length > 0 || (r.verdict === 'ok' && !trusted);
    const key = r.verdict + r.findings.map((f) => f.title).join('|');
    if (host) host.remove();
    if (!show || key === hiddenKey) return;

    host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const color = COLORS[r.verdict];
    const items = (serious.length ? serious : r.findings).slice(0, 5);
    shadow.innerHTML = `
      <style>
        .box{position:fixed;z-index:2147483647;right:20px;bottom:20px;width:380px;max-height:80vh;overflow:auto;background:#fff;color:#101828;
          border-radius:16px;box-shadow:0 20px 50px rgba(16,24,40,.25);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;border-top:6px solid ${color}}
        header{display:flex;gap:10px;align-items:center;padding:14px 16px 6px}
        .dot{width:34px;height:34px;border-radius:50%;background:${color};color:#fff;display:grid;place-items:center;font-weight:700;font-size:18px;flex:none}
        h2{margin:0;font-size:16px}.sub{color:#667085;font-size:12px}
        ul{list-style:none;margin:0;padding:6px 16px}li{padding:8px 0;border-bottom:1px solid #f2f4f7}
        li b{display:block}li span{color:#475467;font-size:13px}
        .sev{display:inline-block;font-size:11px;font-weight:700;border-radius:99px;padding:1px 8px;margin-bottom:2px;color:#fff}
        .who{margin:6px 16px;padding:10px 12px;background:#f9fafb;border-radius:10px;font-size:13px}
        footer{display:flex;gap:8px;padding:10px 16px 14px;flex-wrap:wrap}
        button{border:0;border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer;background:#f2f4f7;color:#101828}
        button.main{background:#101828;color:#fff}
      </style>
      <section class="box" role="alert">
        <header><div class="dot">${r.verdict === 'ok' ? '✓' : '!'}</div>
          <div><h2></h2><div class="sub">Платёжный помощник · ${location.hostname}</div></div></header>
        <ul></ul>
        <div class="who" hidden></div>
        <footer><button class="main" data-a="close">Понятно</button>${r.verdict === 'ok' ? '<button data-a="trust">Доверять этому сайту</button>' : ''}</footer>
      </section>`;
    shadow.querySelector('h2').textContent = PGChecks.VERDICTS[r.verdict].title;
    const ul = shadow.querySelector('ul');
    const SEV = { danger: ['Опасно', '#d92d20'], warning: ['Подозрительно', '#dc6803'], info: ['К сведению', '#667085'], error: ['Ошибка', '#667085'] };
    for (const f of items) {
      const li = document.createElement('li');
      const s = document.createElement('i'); s.className = 'sev'; s.textContent = SEV[f.severity][0]; s.style.background = SEV[f.severity][1];
      const b = document.createElement('b'); b.textContent = f.title;
      const d = document.createElement('span'); d.textContent = f.details.map((t) => /[.!?»)]$/.test(t) ? t : t + '.').join(' ');
      li.append(s, b, d); ul.append(li);
    }
    if (r.recipient.items.length) {
      const who = shadow.querySelector('.who');
      who.hidden = false;
      who.textContent = 'Кому уйдут деньги: ' + r.recipient.items.map((i) => i.text).join('; ');
    }
    shadow.querySelector('footer').addEventListener('click', async (e) => {
      const a = e.target.dataset.a;
      if (a === 'close') { hiddenKey = key; host.remove(); }
      if (a === 'trust') {
        const { trusted = {} } = await api.storage.local.get('trusted');
        trusted[location.origin] = new Date().toISOString();
        await api.storage.local.set({ trusted });
        hiddenKey = key; host.remove();
      }
    });
    document.documentElement.append(host);
  }

  schedule(700);
  setTimeout(run, 4000); // повторная проверка: часть страниц дорисовывается скриптами
})();
