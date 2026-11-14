"""Скачивает с urlscan.io сохранённые данные отобранных настоящих мошеннических страниц.

Для каждой страницы: снимок экрана (screenshot.png), код страницы после загрузки (dom.html — так его увидел браузер
urlscan, скрипты уже отработали) и отчёт о сканировании (result.json: сетевые запросы, ссылки, сертификат).
Сами страницы не открываются. Файлы — чужой недоверенный код: они лежат вне проекта, в datasets/web_pages/urlscan/,
и в лаборатории открываются только во фрейме без выполнения скриптов (lab/eval/one.html, sandbox без allow-scripts).

Запуск:  set URLSCAN_KEY=...  &&  .venv\\Scripts\\python.exe tools\\urlscan_fetch.py
Отбор — в списке PICK ниже (по candidates.json от tools/urlscan_search.py) и все ClickFix-страницы из candidates.json.
"""
import gzip
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / 'datasets' / 'web_pages' / 'urlscan'

# Отобраны вручную по заголовку и домену: подделки российских брендов под схемы, которые ловит расширение.
PICK = {
    '01a1b763-90f9-74d9-b862-cccffe7e5988': 'Мамонт: поддельное «Оформление заказа» Авито (avito-payment.com)',
    '01a1d19a-aa48': 'Мамонт: «MIR Pay — Платёжный сервис» под СДЭК',
    '01a1cec7-96b7': 'Поддельный портал Госуслуг на домене с «cdek»',
    '01a1c5f5-e0cb': 'Поддельный портал Госуслуг на домене с «cdek» (.online)',
    '01a1d06d-7000': 'Поддельная «акция Ozon» (буквы в заголовке смешаны)',
    '01a1d3b0-3c3b': 'Поддельный Wildberries (кириллическая «е» в заголовке)',
    '01a0668b-d4ab': 'Поддельное «отслеживание посылки» Boxberry',
    '01a107b8-2e43': '«Кофейня — оплата за столом» с меткой phishing',
    '01a1cf99-b77c': '«Экспресс почта» — подозрительная служба доставки',
    # Поддельная «оплата подписки ChatGPT»: один набор, размещённый на взломанных сайтах в папке /openurass/web/pay.php.
    '01a1cb75-901e-72af-880c-4abb11fe46f9': 'Набор «оплата ChatGPT»: форма карты (checkout.desbau.com)',
    '01a13b3a-9f05-7062-9ce0-6ffd3716af38': 'Набор «оплата ChatGPT»: «OpenAI Subscription» (lilian-maria.de)',
    '01a1c4a3-e9eb-75f7-a086-307234c4fab2': 'Набор «оплата ChatGPT»: первый шаг «Security verification» (sidermarsrl.it)',
    '01a1bf39-a74b-7729-94ce-45578d0c4a03': 'Набор «оплата ChatGPT»: первый шаг, польская версия (flatsrl.com)',
    '01a13924-6651-706c-8916-c6a606325f62': 'Набор «оплата ChatGPT»: первый шаг (progettienergetici.com)',
    '01a12fb1-3624-769a-9f94-4020b5ce1cd0': 'Набор «оплата ChatGPT»: первый шаг, испанская версия (musikfactory.it)',
    '01a0a390-ce6e-76aa-b27a-92d28e23f00e': 'Набор «оплата ChatGPT»: первый шаг (skydivecostadargento.com)',
}


def get(url, key, binary=False):
    req = urllib.request.Request(url, headers={'API-Key': key, 'User-Agent': 'payment-helper-research'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if data[:2] == b'\x1f\x8b':  # urlscan отдаёт код страницы сжатым (gzip) даже без запроса сжатия
        data = gzip.decompress(data)
    return data if binary else data.decode('utf-8', errors='replace')


def main():
    key = os.environ.get('URLSCAN_KEY')
    if not key:
        sys.exit('Нужна переменная окружения URLSCAN_KEY')
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    cand = json.loads((OUT / 'candidates.json').read_text(encoding='utf-8'))
    every = [r for rows in cand.values() for r in rows]
    picked = []
    for prefix, why in PICK.items():
        row = next((r for r in every if r['uuid'].startswith(prefix)), None) or {'uuid': prefix, 'scheme': 'manual'}
        picked.append(dict(row, why=why, scheme='brand'))
    skip = re.compile(r'redirecting|attention required|403|404|not found|index of|parked|error|^$', re.I)
    for r in cand.get('clickfix', []):
        if not skip.search(r['title'] or ''):
            picked.append(dict(r, why='Страница с меткой ClickFix (поддельная проверка «я не робот»)', scheme='clickfix'))
    index = []
    for r in picked:
        uid = r['uuid']
        d = OUT / uid
        d.mkdir(parents=True, exist_ok=True)
        try:
            if not (d / 'result.json').exists():
                res = json.loads(get(f'https://urlscan.io/api/v1/result/{uid}/', key))
                (d / 'result.json').write_text(json.dumps(res, ensure_ascii=False), encoding='utf-8')
            res = json.loads((d / 'result.json').read_text(encoding='utf-8'))
            if not (d / 'dom.html').exists():
                (d / 'dom.html').write_text(get(f'https://urlscan.io/dom/{uid}/', key), encoding='utf-8')
            if not (d / 'screenshot.png').exists():
                (d / 'screenshot.png').write_bytes(get(f'https://urlscan.io/screenshots/{uid}.png', key, binary=True))
        except Exception as e:
            print('не скачано', uid, e)
            continue
        page = res.get('page', {})
        index.append({'uuid': uid, 'scheme': r['scheme'], 'why': r['why'], 'url': page.get('url') or r.get('url'),
                      'domain': page.get('domain'), 'title': page.get('title'), 'time': res.get('task', {}).get('time'),
                      'tls_from': page.get('tlsValidFrom'), 'tls_issuer': page.get('tlsIssuer'), 'ip': page.get('ip'), 'country': page.get('country'),
                      'dom_bytes': (d / 'dom.html').stat().st_size})
        print(f"{r['scheme']:8} {uid[:13]} {page.get('domain')} | {(page.get('title') or '')[:60]}")
        time.sleep(0.6)
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    print('страниц:', len(index), '→', OUT / 'index.json')


if __name__ == '__main__':
    main()
