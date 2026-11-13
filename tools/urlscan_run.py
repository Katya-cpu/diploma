"""Прогон анализатора расширения на коде настоящих мошеннических страниц с urlscan.io.

Берёт страницы, скачанные tools/urlscan_fetch.py (datasets/web_pages/urlscan/<uuid>/dom.html), и прогоняет на них
тот же анализатор, что в расширении, в Firefox без окна (как оценка «было / стало», lab/eval/one.html).

Безопасность: это код мошеннических страниц. Перед прогоном в каждую копию вставляется запрет на любые сетевые
запросы (Content-Security-Policy: default-src 'none'), а во фрейме лаборатории скрипты не выполняются (sandbox без
allow-scripts). Поэтому при прогоне ни один запрос к серверам мошенников не уходит.

Ограничение: проверяется код страницы на том шаге, который сохранил urlscan. Скрипты не выполняются, карта не вводится,
посторонние скрипты не скачиваются — проверки поведения (скиммер, подмена реквизитов) здесь не участвуют.

Запуск (лаборатория должна быть запущена): .venv\\Scripts\\python.exe tools\\urlscan_run.py
Результат: tools/urlscan-results.json и lab/real/results.js (для страницы «Проверки»).
"""
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eval_run  # noqa: E402  (тот же Firefox и та же страница one.html)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / 'datasets' / 'web_pages' / 'urlscan'
CORPUS = ROOT.parent / 'datasets' / 'web_pages' / 'eval_sample'  # сервер лаборатории отдаёт эту папку как /corpus/
DST = CORPUS / 'urlscan'
# Никаких сетевых запросов: ни скриптов, ни картинок, ни стилей с чужих серверов. Только встроенные стили и data:-картинки.
CSP = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">"


def prepare(html):
    html = re.sub(r'(?is)<meta[^>]+http-equiv=["\']?(refresh|content-security-policy)[^>]*>', '', html)
    html = re.sub(r'(?is)<base[^>]*>', '', html)  # иначе относительные адреса указывали бы на сайт мошенников
    if re.search(r'(?i)<head[^>]*>', html):
        return re.sub(r'(?i)(<head[^>]*>)', lambda m: m.group(1) + CSP, html, count=1)
    return CSP + html


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    index = json.loads((SRC / 'index.json').read_text(encoding='utf-8'))
    DST.mkdir(parents=True, exist_ok=True)
    items = []
    for p in index:
        dom = SRC / p['uuid'] / 'dom.html'
        try:  # часть файлов блокирует или удаляет антивирус Windows — такие страницы пропускаются
            (DST / (p['uuid'] + '.html')).write_text(prepare(dom.read_text(encoding='utf-8', errors='replace')), encoding='utf-8')
        except OSError as e:
            print('пропущено (антивирус?):', p['domain'], e.__class__.__name__)
            continue
        items.append(dict(p, file='urlscan/' + p['uuid'] + '.html'))
    done, part = {}, ROOT / 'tools' / 'urlscan-partial.json'
    for _ in range(3):
        todo = [it for it in items if it['file'] not in done]
        if not todo:
            break
        try:
            asyncio.run(eval_run.firefox_pass(todo, done, part, len(items)))
        except Exception as e:
            print('перезапуск Firefox:', type(e).__name__, e, flush=True)
    part.unlink(missing_ok=True)
    rows = [dict({k: v for k, v in done[it['file']].items() if k != 'old'}) for it in items if it['file'] in done]
    (ROOT / 'tools' / 'urlscan-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    for r in rows:
        n = r['new']
        print(f"{r['scheme']:8} {n['verdict']:8} {r['domain'][:42]:42} {'; '.join(n.get('titles', []))[:110]}")


if __name__ == '__main__':
    main()
