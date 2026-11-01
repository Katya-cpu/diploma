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

  // Картинки, которые появились позже (фото QR-кода в мессенджере, просмотрщик изображений):
  // как только загрузилась крупная картинка — проверяем страницу ещё раз.
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG' && Math.min(img.naturalWidth, img.naturalHeight) >= 150) schedule(800);
  }, true);
  // Одностраничные приложения меняют адрес без перезагрузки.
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; hiddenKey = ''; schedule(1000); } }, 1000);

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
    const items = (serious.length ? serious : r.findings).slice(0, 5);
    shadow.innerHTML = `
      <style>
        .box{position:fixed;z-index:2147483647;right:18px;bottom:18px;width:370px;max-width:calc(100vw - 36px);max-height:78vh;overflow:auto;
          background:#fff;color:#292929;border:1px solid #bdbdbd;border-radius:3px;box-shadow:0 2px 9px rgba(0,0,0,.10);font:13px/1.45 Arial,Helvetica,sans-serif;text-align:left}
        header{display:flex;gap:9px;align-items:flex-start;padding:13px 15px 11px;border-bottom:1px solid #e4e4e4}
        .dot{display:none}
        h2{margin:0;font:600 14px/1.35 Arial,Helvetica,sans-serif}.sub{margin-top:4px;color:#777;font-size:11px}
        ul{list-style:none;margin:0;padding:3px 15px}li{padding:10px 0;border-bottom:1px solid #ededed}li:last-child{border-bottom:0}
        li b{display:block;font-size:12px;font-weight:600}li span{display:block;margin-top:4px;color:#666;font-size:12px}
        .sev{display:block;margin-bottom:4px;padding:0;border:0;border-radius:0;background:transparent!important;color:#777;font:normal 10px/1.4 Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.35px}
        .who{margin:0 15px;padding:11px 0;border-top:1px solid #e4e4e4;background:#fff;font-size:12px;color:#555}
        footer{display:flex;gap:7px;padding:11px 15px 13px;flex-wrap:wrap}
        button{border:1px solid #c5c5c5;border-radius:2px;padding:6px 11px;font:12px Arial,Helvetica,sans-serif;cursor:pointer;background:#f7f7f7;color:#333}
        button:hover{background:#eee}button:focus-visible{outline:1px solid #666;outline-offset:2px}button.main{background:#fff;color:#222;border-color:#aaa}
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
