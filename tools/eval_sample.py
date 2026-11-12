"""Выборка настоящих страниц из Phish360 для оценки ложных тревог и обнаружения.

Phish360 (Hacettepe University) — архив реальных фишинговых и законных страниц с исходным HTML.
Файлы: datasets/web_pages/archives/phish360_{legit,phish}.parquet (скачаны ранее).

Результат: datasets/web_pages/eval_sample/{legit,phish}/<n>.html и index.json.
Лаборатория отдаёт их по адресу /corpus/... и прогоняет на них старую и новую версию анализатора (lab/eval.html).

Безопасность. В начало каждой страницы вставляется запрет (Content-Security-Policy):
  фишинговые — никаких внешних загрузок вообще; законные — только стили, шрифты и картинки по https.
Скрипты не выполняются: страница открывается во фрейме sandbox без разрешения на скрипты.

Запуск: .venv\\Scripts\\python.exe tools\\eval_sample.py
"""
from pathlib import Path
import json
import re
import numpy as np
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
ARCH = ROOT.parent / 'datasets' / 'web_pages' / 'archives'
OUT = ROOT.parent / 'datasets' / 'web_pages' / 'eval_sample'
N_LEGIT, N_PHISH = 1000, 1000
CARD = re.compile(r'cc-number|card.?num|cardnumber|номер карты|card number|cvv|cvc', re.I)
CSP = {
    'phish': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    'legit': "default-src 'none'; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data:",
}


def main():
    rng = np.random.default_rng(42)
    index = []
    for label, n_take in (('legit', N_LEGIT), ('phish', N_PHISH)):
        t = pq.read_table(ARCH / f'phish360_{label}.parquet', columns=['URL', 'brand', 'html_text_language', 'full_html']).to_pandas()
        t = t[t['full_html'].fillna('').str.len() > 500].reset_index(drop=True)
        ru = t.index[t['html_text_language'].fillna('').str.startswith('ru')].tolist()
        card = t.index[t['full_html'].str.contains(CARD)].tolist() if label == 'phish' else []
        chosen = list(dict.fromkeys(ru + card))[:n_take]
        rest = [i for i in rng.permutation(len(t)) if i not in set(chosen)]
        chosen += rest[:max(0, n_take - len(chosen))]
        (OUT / label).mkdir(parents=True, exist_ok=True)
        for k, i in enumerate(chosen):
            row = t.iloc[int(i)]
            html = row['full_html']
            meta = f'<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{CSP[label]}">'
            m = re.search(r'<head[^>]*>', html, re.I)
            html = html[:m.end()] + meta + html[m.end():] if m else meta + html
            (OUT / label / f'{k}.html').write_text(html, encoding='utf-8')
            index.append({'file': f'{label}/{k}.html', 'label': label, 'url': str(row['URL'])[:200],
                          'brand': str(row['brand'] or ''), 'lang': str(row['html_text_language'] or ''),
                          'card_fields': bool(CARD.search(html))})
        print(label, len(chosen), 'страниц; русских', sum(1 for i in chosen if i in set(ru)), '; с полями карты', sum(1 for x in index if x['label'] == label and x['card_fields']))
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
