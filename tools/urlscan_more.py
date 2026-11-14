"""Поиск настоящих страниц на urlscan.io по каждому виду мошенничества (второй сбор, 14.11.2026).

Для каждой схемы — несколько запросов к поиску urlscan.io (по заголовку страницы, домену или метке сканирования).
Берётся до PER_QUERY разных доменов на запрос, только ответ 200 за последний год.
Скачивается снимок экрана (доступен без ключа). Если задан ключ URLSCAN_KEY — ещё код страницы (dom.html)
и отчёт (result.json), чтобы прогнать на них анализатор и снять работу расширения (tools/real_pages.py).

Сами страницы не открываются: urlscan уже просканировал их и хранит снимок и код.
Запуск:  [set URLSCAN_KEY=...]  python -I tools/urlscan_more.py
Результат: datasets/web_pages/urlscan2/<uuid>/ и datasets/web_pages/urlscan2/index.json
"""
import gzip
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / 'datasets' / 'web_pages' / 'urlscan2'
PER_QUERY = 6

# Запросы подобраны вручную: без ключа urlscan не разрешает шаблоны со звёздочкой, поэтому — точные фразы и метки.
QUERIES = {
    'fake-payment': ['page.title:"Оплата заказа - bePaid"', 'page.title:"Оплата заказа"', 'page.title:"Безопасная сделка" AND task.tags:phishing',
                     'page.title:"USPS" AND task.tags:phishing', 'page.title:"Redelivery"', 'page.title:"Secure Checkout" AND task.tags:phishing'],
    'investment': ['page.title:"Quantum AI"', 'page.title:"Immediate Edge"', 'page.title:"AI Trading Platform"', 'page.title:"Trading Platform" AND task.tags:phishing',
                   'page.title:"Immediate Connect"', 'page.title:"Bitcoin Era"',
                   'page.title:"стабильный доход от ГазИнвест"', 'page.title:"инвестиционная платформа"', 'page.title:"пассивный доход" AND page.title:USDT',
                   'page.title:"Инвестиционный проект"'],
    'tech-support': ['page.title:"Windows Security Center"', 'page.title:"Windows Security Alert"', 'page.title:"Microsoft Security" AND page.domain:azurefd.net',
                     'page.title:"Security Alert" AND task.tags:phishing'],
    'crypto-drainer': ['task.tags:drainer'],
    'fines': ['page.title:"E-ZPass Service"', 'page.title:"Toll Services"', 'page.title:"Pay Toll"', 'page.title:"FasTrak" AND task.tags:phishing',
              'page.title:"Оплата штрафа"', 'page.title:"Штрафы ГИБДД"'],
    'fake-shop': ['task.tags:fakeshop', 'task.tags:"fake shop"', 'task.tags:fakestore'],
    'payout': ['page.title:"компенсация"', 'page.title:"Получить выплату"', 'page.title:"Claim your reward" AND task.tags:phishing', 'page.title:"refund" AND task.tags:phishing'],
    'safe-account': ['page.title:"Вас взломали"', 'page.title:"Центральный банк" AND task.tags:phishing', 'page.title:"Служба безопасности"'],
    'subscription': ['page.title:"Премиум"', 'page.title:"Пробный период"'],
    'fake-app': ['page.url:*.apk AND task.tags:phishing'],
}
# Запросы со звёздочкой urlscan.io выполняет только с ключом.
KEY_QUERIES = {
    'fines': ['page.domain:*ezpass* AND NOT page.apexDomain:(e-zpassny.com OR ezpassnj.com OR ezpassma.com OR ezpassva.com OR ezpassmd.com OR e-zpassiag.com)',
              'page.domain:*toll* AND task.tags:phishing', 'page.domain:*shtraf*', 'page.domain:*gibdd* AND NOT page.apexDomain:(gibdd.ru OR xn--90adear.xn--p1ai)',
              'page.title:*штраф* AND page.title:*оплат*'],
    'safe-account': ['page.title:*взлом*', 'page.title:*безопасный счет*', 'page.title:*резервный счет*'],
    'fake-app': ['page.url:*.apk AND task.tags:phishing', 'page.url:*.apk AND page.title:*банк*'],
    'tech-support': ['page.title:*Windows Defender* AND NOT page.domain:*microsoft.com', 'page.title:*virus* AND page.title:*detected*'],
    'investment': ['page.title:*инвест* AND page.title:*доход*', 'page.title:*брокер* AND task.tags:phishing'],
    'subscription': ['page.title:*подписк* AND page.title:*1 ₽*', 'page.title:*за 1 рубль*'],
    'fake-payment': ['page.title:*Безопасная сделка*', 'page.domain:*avito* AND page.title:*оплат*', 'page.domain:*cdek* AND page.title:*оплат*'],
}
FILTER = ' AND page.status:200 AND date:>now-365d'


def get(url, key=None, binary=False):
    h = {'User-Agent': 'payment-helper-research'}
    if key:
        h['API-Key'] = key
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
        data = r.read()
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    return data if binary else data.decode('utf-8', 'replace')


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    key = os.environ.get('URLSCAN_KEY')
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / 'index.json'
    index = json.loads(idx_path.read_text(encoding='utf-8')) if idx_path.exists() else []
    seen = {r['uuid'] for r in index}
    domains = {r['domain'] for r in index}
    allq = {k: list(v) for k, v in QUERIES.items()}
    if key:
        for k, v in KEY_QUERIES.items():
            allq.setdefault(k, []).extend(v)
    for scheme, qs in allq.items():
        for q in qs:
            url = 'https://urlscan.io/api/v1/search/?' + urllib.parse.urlencode({'q': q + FILTER, 'size': 60})
            try:
                res = json.loads(get(url, key)).get('results', [])
            except Exception as e:
                print('ошибка запроса', q, e, flush=True)
                time.sleep(3)
                continue
            n = 0
            for r in res:
                p = r.get('page', {})
                dom = p.get('domain') or ''
                if r['_id'] in seen or dom in domains or not p.get('title'):
                    continue
                domains.add(dom)
                seen.add(r['_id'])
                index.append({'uuid': r['_id'], 'scheme': scheme, 'query': q, 'time': r['task']['time'], 'url': p.get('url'),
                              'domain': dom, 'title': p.get('title'), 'tags': r['task'].get('tags', [])})
                n += 1
                if n >= PER_QUERY:
                    break
            print(f'{scheme:15} {n:2}  {q}', flush=True)
            time.sleep(2.2)
    for r in index:
        d = OUT / r['uuid']
        d.mkdir(exist_ok=True)
        try:
            if not (d / 'screenshot.png').exists():
                (d / 'screenshot.png').write_bytes(get(f"https://urlscan.io/screenshots/{r['uuid']}.png", binary=True))
            if key and not (d / 'dom.html').exists():
                (d / 'dom.html').write_text(get(f"https://urlscan.io/dom/{r['uuid']}/", key), encoding='utf-8')
                (d / 'result.json').write_text(get(f"https://urlscan.io/api/v1/result/{r['uuid']}/", key), encoding='utf-8')
                time.sleep(1)
        except Exception as e:
            print('не скачано', r['domain'], e, flush=True)
        r['has_dom'] = (d / 'dom.html').exists()
    idx_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    print('всего страниц:', len(index), ' с кодом:', sum(r['has_dom'] for r in index))


if __name__ == '__main__':
    main()
