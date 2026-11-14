"""Прогон анализатора расширения на страницах из набора Zenodo 14880589 (отобраны tools/zenodo_pick.py).

Как и для urlscan.io: в каждую копию вставляется запрет сетевых запросов и скриптов (Content-Security-Policy),
анализатор запускается в Firefox без окна через lab/eval/one.html.

Запуск (лаборатория должна быть запущена): .venv\\Scripts\\python.exe tools\\zenodo_run.py
Результат: tools/zenodo-results.json
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eval_run  # noqa: E402
from urlscan_run import prepare  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / 'datasets' / 'web_pages' / 'zenodo'
DST = ROOT.parent / 'datasets' / 'web_pages' / 'eval_sample' / 'zenodo'


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    items = []
    for it in json.loads((SRC / 'index.json').read_text(encoding='utf-8')):
        src = SRC / it['dir'] / 'page.html'
        out = DST / (it['dir'].replace('/', '__') + '.html')
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            out.write_text(prepare(src.read_text(encoding='utf-8', errors='replace')), encoding='utf-8')
        except OSError as e:
            print('пропущено (антивирус?):', it['site'], e.__class__.__name__)
            continue
        domain = it['site'].split('/')[-1]
        items.append(dict(it, domain=domain, url='https://' + domain + '/', file='zenodo/' + out.name))
    done, part = {}, ROOT / 'tools' / 'zenodo-partial.json'
    for _ in range(3):
        todo = [it for it in items if it['file'] not in done]
        if not todo:
            break
        try:
            asyncio.run(eval_run.firefox_pass(todo, done, part, len(items)))
        except Exception as e:
            print('перезапуск Firefox:', type(e).__name__, e, flush=True)
    part.unlink(missing_ok=True)
    rows = [{k: v for k, v in done[it['file']].items() if k != 'old'} for it in items if it['file'] in done]
    (ROOT / 'tools' / 'zenodo-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    for r in rows:
        n = r['new']
        print(f"{r['cat']:15} {n['verdict']:8} {r['domain'][:40]:40} {'; '.join(n.get('titles', []))[:100]}")


if __name__ == '__main__':
    main()
