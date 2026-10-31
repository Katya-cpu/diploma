'use strict';
const api = typeof browser !== 'undefined' ? browser : chrome;
const TITLES = { danger: 'Высокий риск — не платите', warning: 'Есть подозрительные признаки', ok: 'Явных признаков обмана не найдено', none: 'Платёжных действий не найдено' };
const SEV = { danger: ['Опасно', '#d92d20'], warning: ['Подозрительно', '#dc6803'], info: ['К сведению', '#667085'], error: ['Ошибка', '#667085'] };
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };

async function load() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const report = await api.runtime.sendMessage({ type: 'get-report', tabId: tab.id });
  const v = document.getElementById('verdict');
  const list = document.getElementById('findings');
  list.textContent = '';
  if (!report) { v.textContent = 'Страница ещё не проверена или проверка здесь недоступна.'; v.className = 'verdict none'; }
  else {
    v.textContent = TITLES[report.verdict]; v.className = 'verdict ' + report.verdict;
    if (report.recipient.items.length) {
      const who = document.getElementById('who'); who.textContent = '';
      who.append(el('h3', 'Кому уйдут деньги'));
      const ul = el('ul'); ul.style.margin = '0 16px';
      report.recipient.items.forEach((i) => ul.append(el('li', i.text)));
      who.append(ul);
    }
    if (!report.findings.length) list.append(el('p', 'Ни одна из 18 проверок не сработала. Это не гарантия безопасности.', 'muted'));
    for (const f of report.findings) {
      const d = el('details'); const s = el('summary');
      const tag = el('span', SEV[f.severity][0], 'tag'); tag.style.background = SEV[f.severity][1];
      s.append(tag, document.createTextNode(f.title)); d.append(s);
      f.details.forEach((t) => d.append(el('p', t, 'why')));
      const c = PGCatalog.byId(f.check);
      if (c) { d.append(el('p', 'Откуда эта проверка: ' + c.scheme, 'why')); }
      list.append(d);
    }
    const lim = document.getElementById('limits'); lim.textContent = '';
    if (report.limits.length) { lim.append(el('h3', 'Что не удалось проверить')); const ul = el('ul'); ul.className = 'muted'; report.limits.forEach((t) => ul.append(el('li', t))); lim.append(ul); }
    const { trusted = {} } = await api.storage.local.get('trusted');
    const origin = new URL(report.url).origin;
    const btn = document.getElementById('untrust');
    btn.hidden = !trusted[origin];
    btn.onclick = async () => { delete trusted[origin]; await api.storage.local.set({ trusted }); btn.hidden = true; };
  }
  document.getElementById('rescan').onclick = () => { api.tabs.sendMessage(tab.id, { type: 'rescan' }); setTimeout(load, 1500); };
  showHistory();
}

async function showHistory() {
  const { history = [] } = await api.storage.local.get('history');
  const box = document.getElementById('history'); box.textContent = '';
  if (!history.length) box.append(el('div', 'Предупреждений пока не было.'));
  history.slice(0, 10).forEach((h) => box.append(el('div', new Date(h.time).toLocaleString('ru-RU') + ' · ' + h.host + ' · ' + h.titles.join('; '))));
}
document.getElementById('clear').onclick = async () => { await api.storage.local.set({ history: [] }); showHistory(); };
load();
