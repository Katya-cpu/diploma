"""Поиск настоящих мошеннических страниц на urlscan.io по схемам, которые ловит расширение.

Сами страницы не открываются: urlscan уже просканировал их и хранит снимок, код (DOM) и сетевые запросы.
Ключ API берётся из переменной окружения URLSCAN_KEY (бесплатный аккаунт на urlscan.io) и никуда не записывается.

Запуск:  set URLSCAN_KEY=...  &&  .venv\\Scripts\\python.exe tools\\urlscan_search.py
Результат: datasets/web_pages/urlscan/candidates.json — по каждой схеме список найденных страниц (адрес, заголовок, дата).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / 'datasets' / 'web_pages' / 'urlscan'

# Схема → запросы. Только живые страницы (ответ 200) за последние 90 дней.
# Двойники брендов, под которые работает «Мамонт» (F6, Group-IB): площадки объявлений, доставка, банки.
BRANDS = ['avito', 'youla', 'cdek', 'sdek', 'pochta', 'boxberry', 'dostavista', 'yandex-dostavka', 'ozon', 'wildberries', 'sberbank', 'tinkoff', 'gosuslugi']
OFFICIAL = {'avito': 'avito.ru', 'youla': 'youla.ru', 'cdek': 'cdek.ru', 'pochta': 'pochta.ru', 'boxberry': 'boxberry.ru', 'ozon': 'ozon.ru',
            'wildberries': 'wildberries.ru', 'sberbank': 'sberbank.ru', 'tinkoff': 'tinkoff.ru', 'gosuslugi': 'gosuslugi.ru'}
QUERIES = {'brand-lookalike': [f'page.domain:*{b}* AND NOT page.apexDomain:{OFFICIAL.get(b, b + ".ru")}' for b in BRANDS],
           'clickfix': ['task.tags:clickfix', 'task.tags:fakecaptcha'],
           'phishing-ru': ['task.tags:phishing AND page.country:RU', 'task.tags:phishing AND page.title:*оплат*']}
FILTER = ' AND page.status:200 AND date:>now-90d'


def search(key, q, size=100):
    url = 'https://urlscan.io/api/v1/search/?' + urllib.parse.urlencode({'q': q + FILTER, 'size': size})
    req = urllib.request.Request(url, headers={'API-Key': key, 'User-Agent': 'payment-helper-research'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    key = os.environ.get('URLSCAN_KEY')
    if not key:
        sys.exit('Нужна переменная окружения URLSCAN_KEY')
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    OUT.mkdir(parents=True, exist_ok=True)
    found = {}
    for scheme, qs in QUERIES.items():
        seen, rows = set(), []
        for q in qs:
            try:
                d = search(key, q)
            except Exception as e:
                print('ошибка запроса', q, e)
                continue
            for r in d.get('results', []):
                p = r.get('page', {})
                dom = p.get('domain') or ''
                if dom in seen or not p.get('title'):  # без заголовка — обычно пустая заглушка
                    continue
                seen.add(dom)
                rows.append({'uuid': r['_id'], 'time': r['task']['time'], 'url': p.get('url'), 'domain': dom, 'title': p.get('title'),
                             'ip': p.get('ip'), 'country': p.get('country'), 'tls_issuer': p.get('tlsIssuer'), 'tls_from': p.get('tlsValidFrom'),
                             'query': q})
            print(f'{scheme:16} {d.get("total", "?"):>6}  {q}')
            time.sleep(1.2)
        found[scheme] = rows
        print(f'  → {scheme}: {len(rows)} страниц с заголовком')
    (OUT / 'candidates.json').write_text(json.dumps(found, ensure_ascii=False, indent=1), encoding='utf-8')
    print('сохранено:', OUT / 'candidates.json')


if __name__ == '__main__':
    main()
