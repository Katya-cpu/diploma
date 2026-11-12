"""Список всех страниц, на которых проверялся анализатор, для просмотра глазами: lab/eval/pages.html.

Берёт результаты прогона (tools/eval-results.json, их пишет tools/eval_run.py) и складывает их в lab/eval/pages-data.js.
Сами сохранённые страницы лежат в datasets/web_pages/eval_sample (legit/, phish/, ru/), лаборатория отдаёт их по адресу /corpus/...

Запуск: python tools/eval_pages.py   (eval_run.py вызывает его сам в конце прогона)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    rows = json.loads((ROOT / 'tools' / 'eval-results.json').read_text(encoding='utf-8'))
    keep = ('file', 'label', 'url', 'brand', 'lang', 'kind', 'card_input', 'password', 'missing', 'old', 'new')
    data = [{k: r[k] for k in keep if k in r} for r in rows]
    out = ROOT / 'lab' / 'eval' / 'pages-data.js'
    out.write_text('// Создано tools/eval_pages.py из tools/eval-results.json — не редактировать вручную.\n'
                   'window.EVAL_PAGES = ' + json.dumps(data, ensure_ascii=False) + ';\n', encoding='utf-8')
    print('записано', out, len(data), 'страниц')


if __name__ == '__main__':
    main()
