/*
 * Фоновая часть расширения:
 *  1) после того как на вкладке начали вводить данные карты, записывает,
 *     на какие сайты страница отправляет запросы (webRequest, только адрес — без содержимого);
 *  2) хранит последний отчёт по каждой вкладке для всплывающего окна и рисует значок;
 *  3) ведёт короткий журнал предупреждений (последние 30) в локальном хранилище.
 */
'use strict';
const api = typeof browser !== 'undefined' ? browser : chrome;
const watching = new Map(); // tabId → { cardInputAt, requests: [] }
const reports = new Map();  // tabId → последний отчёт

// Запросы sendBeacon Firefox может не привязывать к вкладке (tabId = -1) — тогда ищем вкладку по адресу страницы-источника.
function watchedTab(d) {
  if (d.tabId >= 0) return watching.get(d.tabId);
  let origin = '';
  try { origin = new URL(d.originUrl || d.documentUrl || '').origin; } catch (e) { return null; }
  for (const t of watching.values()) if (t.origin === origin) return t;
  return null;
}

api.webRequest.onBeforeRequest.addListener((d) => {
  const t = watchedTab(d);
  if (!t || d.timeStamp < t.cardInputAt) return;
  let host = '';
  try { host = new URL(d.url).hostname; } catch (e) { return; }
  if (t.requests.length < 50) t.requests.push({ host, how: d.type + ' ' + d.method, afterCardInput: true });
}, { urls: ['<all_urls>'] });

api.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) { watching.delete(tabId); reports.delete(tabId); }
});
api.tabs.onRemoved.addListener((tabId) => { watching.delete(tabId); reports.delete(tabId); });

const BADGE = { danger: ['!', '#d92d20'], warning: ['?', '#dc6803'], ok: ['✓', '#12b76a'] };

api.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  if (msg.type === 'card-input') {
    let origin = '';
    try { origin = new URL(sender.url).origin; } catch (e) { /* нет адреса */ }
    watching.set(tabId, { cardInputAt: Date.now() - 50, origin, requests: [] });
  } else if (msg.type === 'network') {
    return Promise.resolve((watching.get(tabId) || {}).requests || []);
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
