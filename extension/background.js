/*
 * Фоновая часть расширения:
 *  1) записывает, на какие сайты страница отправляет запросы (webRequest): адрес, способ и до 4 КБ тела.
 *     Запись нужна проверке «Скиммер»: она ищет в запросах после ввода карты номер этой карты.
 *     Всё хранится только в памяти и стирается при уходе со страницы;
 *  2) хранит последний отчёт по каждой вкладке для всплывающего окна и рисует значок;
 *  3) ведёт короткий журнал предупреждений (последние 30) в локальном хранилище — без реквизитов.
 */
'use strict';
const api = typeof browser !== 'undefined' ? browser : chrome;
const tabs = new Map();    // tabId → { origin, cardInputAt, requests: [] }
const reports = new Map(); // tabId → последний отчёт
const MAX_REQUESTS = 300, MAX_BODY = 4000;

function tabState(tabId) {
  if (!tabs.has(tabId)) tabs.set(tabId, { origin: '', cardInputAt: null, requests: [] });
  return tabs.get(tabId);
}

// Запросы sendBeacon Firefox может не привязывать к вкладке (tabId = -1) — тогда ищем вкладку по адресу страницы-источника.
function findTab(d) {
  if (d.tabId >= 0) return tabState(d.tabId);
  let origin = '';
  try { origin = new URL(d.originUrl || d.documentUrl || '').origin; } catch (e) { return null; }
  for (const t of tabs.values()) if (t.origin === origin) return t;
  return null;
}

// Тело запроса → текст (формы и «сырые» байты). Нужен только поиск номера карты в нём.
function bodyText(rb) {
  if (!rb) return '';
  if (rb.formData) return Object.entries(rb.formData).map(([k, v]) => k + '=' + [].concat(v).join(',')).join('&');
  if (rb.raw) {
    try { return rb.raw.map((p) => (p.bytes ? new TextDecoder().decode(p.bytes) : '')).join(''); } catch (e) { return ''; }
  }
  return '';
}

api.webRequest.onBeforeRequest.addListener((d) => {
  if (d.type === 'main_frame') return;
  const t = findTab(d);
  if (!t || t.requests.length >= MAX_REQUESTS) return;
  let host = '';
  try { host = new URL(d.url).hostname; } catch (e) { return; }
  t.requests.push({ host, how: d.type + ' ' + d.method, url: d.url.slice(0, 3000), body: bodyText(d.requestBody).slice(0, MAX_BODY), at: d.timeStamp });
}, { urls: ['<all_urls>'] }, ['requestBody']);

api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' && info.url) {
    let origin = '';
    try { origin = new URL(info.url).origin; } catch (e) { /* служебная страница */ }
    tabs.set(tabId, { origin, cardInputAt: null, requests: [] });
    reports.delete(tabId);
  }
});
api.tabs.onRemoved.addListener((tabId) => { tabs.delete(tabId); reports.delete(tabId); });

const BADGE = { danger: ['!', '#b42318'], warning: ['?', '#b54708'], ok: ['✓', '#2e6b3f'] };

api.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  if (msg.type === 'card-input') {
    const t = tabState(tabId);
    try { t.origin = new URL(sender.url).origin; } catch (e) { /* нет адреса */ }
    if (!t.cardInputAt) t.cardInputAt = Date.now() - 50;
  } else if (msg.type === 'network') {
    const t = tabs.get(tabId);
    if (!t) return Promise.resolve([]);
    return Promise.resolve(t.requests.map((r) => Object.assign({}, r, { afterCardInput: !!t.cardInputAt && r.at >= t.cardInputAt })));
  } else if (msg.type === 'report') {
    reports.set(tabId, msg.report);
    const b = BADGE[msg.report.verdict];
    api.browserAction.setBadgeText({ tabId, text: b ? b[0] : '' });
    if (b) api.browserAction.setBadgeBackgroundColor({ tabId, color: b[1] });
    if (msg.report.verdict === 'danger' || msg.report.verdict === 'warning') return remember(msg.report);
  } else if (msg.type === 'get-report') {
    return Promise.resolve(reports.get(tabId) || null);
  }
});

// Журнал: только итог, сайт и названия признаков. Реквизиты и введённые данные не сохраняются.
async function remember(report) {
  const { history = [] } = await api.storage.local.get('history');
  const titles = report.findings.filter((f) => f.severity === 'danger' || f.severity === 'warning').map((f) => f.title);
  const last = history[0];
  if (last && last.url === report.url && last.titles.join() === titles.join()) return;
  history.unshift({ time: new Date().toISOString(), url: report.url, host: report.context.host, verdict: report.verdict, titles });
  await api.storage.local.set({ history: history.slice(0, 30) });
}
