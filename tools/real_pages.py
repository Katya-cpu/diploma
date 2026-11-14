"""Сводка настоящих мошеннических страниц по видам мошенничества (раздел «Мошенничество и проверки» лаборатории).

Источники и что о них известно:
  urlscan.io, сбор 13.11.2026 — datasets/web_pages/urlscan (код + снимок), вердикты: tools/urlscan-results.json;
  urlscan.io, сбор 14.11.2026 — datasets/web_pages/urlscan2 (снимок; код — только при ключе URLSCAN_KEY);
  Zenodo 14880589 (2024)     — datasets/web_pages/zenodo (код + снимок), вердикты: tools/zenodo-results.json;
  Phish360 (2020–2023)       — фишинговые страницы с полем карты из оценки «было / стало» (код, снимков в наборе нет).

Шаги:
  python -I tools/real_pages.py plan     → tools/real-pages.json (что снимать в Firefox с расширением)
  .venv\\Scripts\\python.exe tools/real_shots.py
  python -I tools/real_pages.py gallery  → lab/real/gallery.js и уменьшенные снимки оригиналов lab/real/orig/
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WP = ROOT.parent / 'datasets' / 'web_pages'
LAB = ROOT / 'lab'
ALARM = ('danger', 'warning')
# Поле номера карты в коде страницы (грубая независимая проверка — чтобы найти пропуски помощника, а не вместо него).
CARD_INPUT = re.compile(r'<input[^>]*(?:cc-number|card.?num|cardnumber|ccnum|name=["\']?(?:cc|card)["\'\s>]|'
                        r'placeholder=["\'][^"\']*(?:card number|номер карты|0000 0000|1234 1234))', re.I)

# urlscan, сбор 13.11.2026: схема по пометке при отборе.
URLSCAN_SCHEME = {'clickfix': 'clickfix', 'subscription': 'subscription', 'pressure': 'fines', 'safe-account': 'safe-account',
                  'fake-app': 'fake-app', 'card': 'fake-shop', 'skimmer': 'skimmer'}
URLSCAN_BY_DOMAIN = {'gosuslugicdek-app.com': 'account-theft', 'gosuslugicdek-app.online': 'account-theft', 'socportalfns3.shop': 'account-theft',
                     'vzj4noiy-ozon.easycops.com': 'payout', 's902ix4f-wildberries.easycops.com': 'payout', 'gov-gibdd.ru': 'fines'}

# Zenodo: категория отбора по словам в коде (tools/zenodo_pick.py) → схема. Уточнения по снимкам — ZEN_FIX (просмотрены вручную).
ZEN_SCHEME = {'fake-payment': 'fake-payment', 'fines': 'fines', 'tech-support': 'tech-support', 'crypto-drainer': 'crypto-drainer',
              'investment': 'investment', 'payout': 'payout'}
ZEN_FIX = json.loads((ROOT / 'tools' / 'zenodo-review.json').read_text(encoding='utf-8')) if (ROOT / 'tools' / 'zenodo-review.json').exists() else {}

ESKIM = [
    ('es-lab1', 'eskimming/lab1/checkout_single.html', '#card-number', 'Lab 1: классический Magecart — код дописан в скрипт оформления заказа'),
    ('es-lab2-overlay', 'eskimming/lab2/banking.html?variant=form-overlay', '#card-number', 'Lab 2: поддельная форма поверх настоящей'),
    ('es-lab2-shadow', 'eskimming/lab2/banking.html?variant=shadow-skimmer', '#card-number', 'Lab 2: скиммер прячется в Shadow DOM'),
    ('es-lab2-monitor', 'eskimming/lab2/banking.html?variant=dom-monitor', '#card-number', 'Lab 2: скиммер следит за изменениями страницы'),
    ('es-lab4', 'eskimming/lab4/index.html', '#card-number', 'Lab 4: код скиммера спрятан в картинке значка сайта (стеганография)'),
]

# Phish360: схема по бренду страницы.
P360_SCHEME = lambda brand: 'fake-payment'  # копии банков, PayPal, Amazon, Netflix с формой карты: «обновите платёжные данные»


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8')) if Path(p).exists() else []



def collect():
    rows = []
    for r in load(ROOT / 'tools' / 'urlscan-results.json'):
        sch = URLSCAN_BY_DOMAIN.get(r['domain']) or URLSCAN_SCHEME.get(r['scheme']) or 'fake-payment'
        rows.append({'id': 'u-' + r['uuid'][:13], 'scheme': sch, 'source': 'urlscan.io', 'date': r['time'][:10], 'domain': r['domain'],
                     'title': r.get('title') or r.get('why', ''), 'file': r['file'], 'orig': str(WP / 'urlscan' / r['uuid'] / 'screenshot.png'),
                     'link': f"https://urlscan.io/result/{r['uuid']}/", 'verdict': r['new']['verdict'], 'titles': r['new'].get('titles', [])})
    for r in load(ROOT / 'tools' / 'zenodo-results.json'):
        fix = {}
        for rx, scheme, note in ZEN_FIX.get('rules', []):
            if re.search(rx, r['domain'], re.I):
                fix = {'scheme': scheme, 'note': note}
                break
        sch = fix.get('scheme') or ZEN_FIX.get('default', {}).get(r['cat']) or ZEN_SCHEME[r['cat']]
        if sch == 'skip':
            continue
        rows.append({'id': 'z-' + re.sub(r'[^a-z0-9]+', '-', r['domain'].lower())[:40], 'scheme': sch, 'source': 'Zenodo 14880589',
                     'date': r['site'].split('/')[1], 'domain': r['domain'], 'title': fix.get('title', ''), 'note': fix.get('note', ''),
                     'file': r['file'], 'orig': str(WP / 'zenodo' / r['dir'] / 'page.png'), 'link': None,
                     'verdict': r['new']['verdict'], 'titles': r['new'].get('titles', []),
                     'cardinput': bool(CARD_INPUT.search((WP / 'zenodo' / r['dir'] / 'page.html').read_text(encoding='utf-8', errors='replace')))})
    for r in load(ROOT / 'tools' / 'eval-results.json'):
        if r['label'] != 'phish' or not r.get('card_input'):
            continue
        dom = re.sub(r'^https?://', '', r['url']).split('/')[0]
        rows.append({'id': 'p-' + Path(r['file']).stem, 'scheme': P360_SCHEME(r.get('brand')), 'source': 'Phish360', 'date': '2020–2023',
                     'domain': dom, 'title': 'подделка ' + (r.get('brand') or ''), 'file': r['file'], 'orig': None, 'link': None,
                     'verdict': r['new']['verdict'], 'titles': r['new'].get('titles', []), 'brand': r.get('brand')})
    # E-Skimming Labs: учебные копии атак Magecart (код скиммера взят из разборов реальных атак). Страница работает со скриптами,
    # тестовая карта вводится с клавиатуры. Сервер злоумышленника в учебной копии стоит на том же адресе, что и магазин.
    ev = load(ROOT / 'tools' / 'eskimming-verdicts.json') or {}
    for lid, file, sel, what in ESKIM:
        v = ev.get(lid, {})
        rows.append({'id': lid, 'scheme': 'skimmer', 'source': 'E-Skimming Labs (учебная копия)', 'date': '2025', 'domain': file.split('/')[1],
                     'title': what, 'note': v.get('note', ''), 'file': file, 'type': sel, 'orig': None,
                     'link': 'https://github.com/pci-tamper-protect/e-skimming-labs', 'verdict': v.get('verdict'), 'titles': v.get('titles', [])})
    rev = load(ROOT / 'tools' / 'urlscan2-review.json') or {}
    res2 = {r['uuid']: r for r in load(ROOT / 'tools' / 'urlscan2-results.json')}
    for r in load(WP / 'urlscan2' / 'index.json'):
        if r['domain'] in rev.get('skip', []) or any(r['domain'].startswith(x) for x in rev.get('skip_prefix', [])):
            continue
        sch = next((v for k, v in rev.get('scheme', {}).items() if k in r['domain']), r['scheme'])
        rows.append({'id': 'v-' + r['uuid'][:13], 'scheme': sch, 'source': 'urlscan.io', 'date': r['time'][:10], 'domain': r['domain'],
                     'title': r['title'], 'file': res2[r['uuid']]['file'] if r['uuid'] in res2 else None,
                     'orig': str(WP / 'urlscan2' / r['uuid'] / 'screenshot.png'), 'link': f"https://urlscan.io/result/{r['uuid']}/",
                     'verdict': res2[r['uuid']]['new']['verdict'] if r['uuid'] in res2 else None,
                     'titles': res2[r['uuid']]['new'].get('titles', []) if r['uuid'] in res2 else [],
                     'note': next((v for k, v in rev.get('notes', {}).items() if re.search(k, r['domain'])), '')})
    return rows


# Шаг схемы, на котором сохранена страница. Размечается независимо от помощника — грубыми правилами по коду страницы,
# чтобы отделить «помощник промолчал, потому что денег ещё не просили» от «пропустил».
#   pay     — страница сама просит деньги или доступ к ним: поле карты, кнопка оплаты рядом с суммой, подключение кошелька;
#   contact — запугивание и контакт «поддержки»: номер телефона или ссылка на Telegram;
#   lead    — только форма заявки с телефоном (дальше звонит «менеджер»);
#   first   — первый шаг: витрина, новость-приманка, вход, проверка Cloudflare.
STAGE_PAY = re.compile(r'<input[^>]*(?:cc-number|card.?num|cardnumber|ccnum|name=["\']?(?:cc|card)["\'\s>]|placeholder=["\'][^"\']*(?:card number|номер карты|0000 0000|1234 1234))', re.I)
STAGE_BTN = re.compile(r'>\s*(?:pay(?: now| toll)?|proceed to payment|оплатить|перейти к оплате|complete (?:purchase|order)|place order)\s*<', re.I)
STAGE_SUM = re.compile(r'[$€£₽₸]\s?\d|\d[\d\s.,]*\s?(?:[$€£₽₸]|руб)', re.I)
STAGE_WALLET = re.compile(r'connect (?:your )?wallet|подключ\w* кошел', re.I)
STAGE_CALL = re.compile(r'(?:call|позвоните|звоните|toll[ -]?free)[^<]{0,80}?\+?\d[\d\s().-]{8,}\d|t\.me/', re.I)
STAGE_TEL = re.compile(r'<input[^>]*(?:type=["\']?tel|name=["\']?(?:phone|tel)|placeholder=["\'][^"\']*(?:телефон|phone))', re.I)


def stage_of(path):
    try:
        h = Path(path).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return None
    body = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', h)
    if STAGE_PAY.search(h) or (STAGE_BTN.search(body) and STAGE_SUM.search(body)) or STAGE_WALLET.search(body):
        return 'pay'
    if STAGE_CALL.search(body):
        return 'contact'
    if STAGE_TEL.search(h):
        return 'lead'
    return 'first'


def plan():
    rows = collect()
    pick, per = [], {}
    for r in rows:
        r['blur'] = 'azurefd.net' in r['domain']  # приманка с откровенными картинками
        if not r['file']:
            continue
        if r['source'].startswith('E-Skimming'):
            pick.append(r)
            continue
        key = (r['scheme'], r['source'])
        alarm = r['verdict'] in ALARM
        if r['source'] == 'Phish360':
            # Из 1000 фишинговых страниц Phish360 — по одной на бренд, где помощник сработал, и все пропуски с полем карты.
            b = r.get('brand')
            if alarm and per.get(('p360', b), 0) < 1:
                per[('p360', b)] = 1
                pick.append(r)
            continue
        if r['id'].startswith('v-') and not alarm and per.get(key + ('v',), 0) >= 8:
            continue
        if r['id'].startswith('v-') and not alarm:
            per[key + ('v',)] = per.get(key + ('v',), 0) + 1
        if r['source'] == 'urlscan.io' and r['scheme'] == 'clickfix' and not alarm:
            if per.get(key, 0) >= 3:
                continue
        if r['source'].startswith('Zenodo') and not alarm and not r.get('cardinput'):
            if per.get(key, 0) >= 6:  # без поля карты и без тревоги — несколько примеров «первого шага» на схему
                continue
        per[key] = per.get(key, 0) + 1
        pick.append(r)
    (ROOT / 'tools' / 'real-pages.json').write_text(json.dumps(pick, ensure_ascii=False, indent=1), encoding='utf-8')
    print('снимать:', len(pick))


def gallery():
    from PIL import Image
    rows = collect()
    for r in rows:  # шаг схемы — по сохранённому коду страницы (E-Skimming: форма оплаты)
        r['stage'] = 'pay' if r['source'].startswith('E-Skimming') else (stage_of(WP / 'eval_sample' / r['file'].split('?')[0]) if r.get('file') else None)
    shots = {p.stem for p in (LAB / 'real' / 'ext').glob('*.jpg')}
    # Страницы, удалённые к моменту сканирования (на снимке — «404»): в галерею не попадают.
    gone = {'u-01a1d19a-aa48'}
    rows = [r for r in rows if r['id'] not in gone]
    (LAB / 'real' / 'orig').mkdir(parents=True, exist_ok=True)
    out = {}
    for r in rows:
        r['img'] = f"real/ext/{r['id']}.jpg" if r['id'] in shots else None
        if not r['img'] and r['orig'] and Path(r['orig']).exists():
            t = LAB / 'real' / 'orig' / (r['id'] + '.jpg')
            if not t.exists():
                im = Image.open(r['orig']).convert('RGB')
                if 'azurefd.net' in r['domain']:
                    from PIL import ImageFilter
                    im = im.filter(ImageFilter.GaussianBlur(28))
                im = im.crop((0, 0, im.width, min(im.height, int(im.width * 0.8))))
                im.thumbnail((640, 640))
                im.save(t, quality=62, optimize=True)
            r['orig'] = f"real/orig/{r['id']}.jpg"
        else:
            r['orig'] = None
        for k in ('file', 'cardinput', 'brand', 'type', 'blur'):
            r.pop(k, None)
        out.setdefault(r['scheme'], []).append(r)
    order = {'danger': 0, 'warning': 1}
    for v in out.values():
        v.sort(key=lambda r: (r['img'] is None, order.get(r['verdict'], 2), r['source']))
    js = '// Настоящие страницы по видам мошенничества (tools/real_pages.py). Создано автоматически.\nwindow.REAL_GALLERY = ' + \
         json.dumps({'schemes': out}, ensure_ascii=False, indent=0) + ';\n'
    (LAB / 'real' / 'gallery.js').write_text(js, encoding='utf-8')
    for k, v in sorted(out.items()):
        print(f"{k:15} всего {len(v):4}  со снимком расширения {sum(1 for r in v if r['img']):3}  "
              f"опасно {sum(r['verdict'] == 'danger' for r in v):3}  подозр. {sum(r['verdict'] == 'warning' for r in v):3}")


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    {'plan': plan, 'gallery': gallery}[sys.argv[1]]()
