"""Прогон анализатора на страницах второго сбора urlscan.io (tools/urlscan_more.py, код скачан с ключом API).

Как и в tools/urlscan_run.py: в копию вставляется запрет скриптов и сетевых запросов, анализатор запускается
в Firefox без окна через lab/eval/one.html. Страницы, отброшенные при разметке (tools/urlscan2-review.json), пропускаются.

Запуск (лаборатория должна быть запущена): .venv\\Scripts\\python.exe tools\\urlscan2_run.py
Результат: tools/urlscan2-results.json
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eval_run  # noqa: E402
from urlscan_run import prepare  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / 'datasets' / 'web_pages' / 'urlscan2'
DST = ROOT.parent / 'datasets' / 'web_pages' / 'eval_sample' / 'urlscan2'


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    rev = json.loads((ROOT / 'tools' / 'urlscan2-review.json').read_text(encoding='utf-8'))
    DST.mkdir(parents=True, exist_ok=True)
    items = []
    for r in json.loads((SRC / 'index.json').read_text(encoding='utf-8')):
        if r['domain'] in rev.get('skip', []) or any(r['domain'].startswith(x) for x in rev.get('skip_prefix', [])):
            continue
        dom = SRC / r['uuid'] / 'dom.html'
        if not dom.exists():
            continue
        try:
            (DST / (r['uuid'] + '.html')).write_text(prepare(dom.read_text(encoding='utf-8', errors='replace')), encoding='utf-8')
        except OSError as e:
            print('пропущено (антивирус?):', r['domain'], e.__class__.__name__)
            continue
        items.append(dict(r, file='urlscan2/' + r['uuid'] + '.html'))
    done, part = {}, ROOT / 'tools' / 'urlscan2-partial.json'
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
    (ROOT / 'tools' / 'urlscan2-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    for r in rows:
        n = r['new']
        print(f"{r['scheme']:15} {n['verdict']:8} {r['domain'][:40]:40} {'; '.join(n.get('titles', []))[:100]}")


if __name__ == '__main__':
    main()
