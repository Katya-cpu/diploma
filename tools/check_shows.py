"""Сверка: всё, что может показать панель расширения, описано в каталоге.

Берёт каждый заголовок находки (title: ...) из extension/core/checks.js и проверяет, что он есть в списке
SHOWS той же проверки в extension/core/catalog.js. И обратно: каждое сообщение из SHOWS есть в коде этой проверки.
Запуск: python tools/check_shows.py  (выход 1, если что-то не сходится).
"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
checks = (ROOT / 'extension/core/checks.js').read_text(encoding='utf-8')
catalog = (ROOT / 'extension/core/catalog.js').read_text(encoding='utf-8')

# Блоки проверок: от CHECKS['id'] до следующего CHECKS[ или до ADVICE.
starts = [(m.start(), m.group(1)) for m in re.finditer(r"CHECKS\['([a-z-]+)'\]\s*=", checks)]
end = checks.index('const ADVICE')
blocks = {cid: checks[a:(starts[i + 1][0] if i + 1 < len(starts) else end)] for i, (a, cid) in enumerate(starts)}

LIT = re.compile(r"'((?:\\.|[^'\\])*)'")
shows_src = catalog[catalog.index('const SHOWS = {'):catalog.index('const PANEL')]
shows = {}
for m in re.finditer(r"'([a-z-]+)': \[(.*?)\]\],?\n(?=    '|  \};)", shows_src, re.S):
    shows[m.group(1)] = [LIT.findall(item)[0] for item in re.findall(r"\[[DWI], ([^\]]*)\]", m.group(2) + ']')]

bad = 0
for cid, code in blocks.items():
    have = shows.get(cid)
    if have is None:
        print(f'НЕТ В КАТАЛОГЕ: проверка {cid} не описана в SHOWS'); bad += 1; continue
    # заголовки в коде: всё от title: до запятой перед details / конца объекта
    for t in re.finditer(r"title:\s*(.+?)(?=,\s*(?:details|advice)\b|\s*\}\)?\s*[,;\]]|,\s*$)", code, re.M | re.S):
        for lit in LIT.findall(t.group(1)):
            piece = lit.strip(' «»')
            if len(piece) < 4:
                continue
            if not any(piece in h for h in have):
                print(f'НЕ ОПИСАНО: {cid}: «{lit}»'); bad += 1
    for h in have:
        for part in (p.strip(' «»') for p in h.split('…')):
            if part and part not in code:
                print(f'НЕТ В КОДЕ: {cid}: «{h}»'); bad += 1

extra = set(shows) - set(blocks)
for cid in extra:
    print(f'ЛИШНЕЕ В КАТАЛОГЕ: {cid}'); bad += 1
total = sum(len(v) for v in shows.values())
print(f'Проверок в коде: {len(blocks)}, описано в каталоге: {len(shows)}, сообщений: {total}. Расхождений: {bad}.')
sys.exit(1 if bad else 0)
