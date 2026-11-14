"""Отбор настоящих мошеннических страниц из набора Zenodo 14880589 под виды мошенничества лаборатории.

Набор: «What's in Phishers: A Longitudinal Study of Security Configurations in Phishing Websites and Kits» (2024–2025),
286 237 фишинговых адресов; на каждый сайт — код страницы (.html), снимок экрана (.png) и сведения (.json).
Архив весит 40 ГБ, поэтому он не скачивается целиком: читается потоком, и сохраняются только сайты, подходящие под схемы.
Остановка — после LIMIT_GB прочитанных гигабайт или когда все категории набраны.

Сохранённый код — чужой и недоверенный: он лежит вне проекта (datasets/web_pages/zenodo/) и открывается только
с запретом скриптов и сетевых запросов (Content-Security-Policy вставляется при подготовке страниц).

Запуск:  python -I tools/zenodo_pick.py [LIMIT_GB]
"""
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / 'datasets' / 'web_pages' / 'zenodo'
URL = 'https://zenodo.org/records/14880589/files/security-configurations-measurement_3months.tar.gz?download=1'
LIMIT_GB = float(sys.argv[1]) if len(sys.argv) > 1 else 6
PER_CAT = 70

CARD = re.compile(r'cc-number|card.?number|cardnumber|cc_?num|name=["\']?(?:card|ccnum|cc)\b|номер карты|credit card|debit card', re.I)
CATS = {
    # Пошлина за доставку, «доплата за адрес», билеты, подписка — форма карты на поддельной странице.
    'fake-payment': lambda t: CARD.search(t) and re.search(r'usps|dhl|fedex|royal mail|post(?:al)?|deliver|parcel|package|redelivery|shipment|доставк|посылк|subscription|renew|ticket', t, re.I),
    # Неоплаченный проезд по платной дороге, штраф, налог.
    'fines': lambda t: re.search(r'toll|e-?zpass|sunpass|fastrak|txtag|peach pass|unpaid (?:toll|fine|parking)|outstanding (?:toll|fine)|traffic (?:fine|violation)|parking (?:fine|violation|ticket)|штраф|tax refund|irs', t, re.I) and re.search(r'pay|оплат|card|fee', t, re.I),
    # «Ваш компьютер заражён — позвоните»: ложная техподдержка.
    'tech-support': lambda t: re.search(r'(?:call|contact|позвоните)[^<]{0,80}(?:\+?1[\s-]?)?\(?8[0-9]{2}\)?[\s-]?[0-9]{3}[\s-]?[0-9]{4}', t, re.I) and re.search(r'virus|infected|trojan|spyware|windows defender|microsoft support|your (?:computer|pc) (?:has been|is) (?:blocked|locked)|security alert|access to this pc', t, re.I),
    # Криптодрейнер: «подключите кошелёк», «получите токены».
    'crypto-drainer': lambda t: re.search(r'connect (?:your )?wallet|walletconnect|claim (?:your )?(?:airdrop|tokens|rewards)|web3modal|wallet ?connect', t, re.I),
    # Инвестплатформа: личный кабинет, депозит, доходность.
    'investment': lambda t: re.search(r'invest(?:ment)? (?:plan|platform)|trading platform|daily (?:profit|return)|guaranteed (?:profit|return)|forex|crypto trading|mining plan|roi\b|инвестиц|доходност', t, re.I) and re.search(r'deposit|withdraw|депозит|вывод', t, re.I),
    # Розыгрыш, приз, компенсация, возврат — «получите деньги».
    'payout': lambda t: CARD.search(t) and re.search(r'refund|compensation|reward|prize|winner|gift|cashback|возврат|компенсац|выплат|приз|розыгрыш', t, re.I),
}


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    OUT.mkdir(parents=True, exist_ok=True)
    count = {c: 0 for c in CATS}
    index = []
    req = urllib.request.Request(URL, headers={'User-Agent': 'research-download'})
    resp = urllib.request.urlopen(req, timeout=120)

    class Meter:  # считает прочитанные сжатые байты
        def __init__(self, f): self.f, self.n = f, 0
        def read(self, k=-1):
            b = self.f.read(k); self.n += len(b); return b

    meter = Meter(resp)
    tar = tarfile.open(fileobj=meter, mode='r|gz')
    site, files = None, {}

    def flush():
        if not site or 'html' not in files:
            return
        text = files['html'].decode('utf-8', 'replace')
        for cat, test in CATS.items():
            if count[cat] >= PER_CAT or not test(text):
                continue
            d = OUT / cat / site.replace('/', '_')
            d.mkdir(parents=True, exist_ok=True)
            for ext, data in files.items():
                (d / ('page.' + ext)).write_bytes(data)
            count[cat] += 1
            index.append({'cat': cat, 'site': site, 'dir': f'{cat}/{site.replace("/", "_")}'})
            print(f'{meter.n / 1e9:5.2f} ГБ  {cat:15} {site}', flush=True)
            break

    for m in tar:
        parts = m.name.split('/')
        if len(parts) < 5 or not m.isfile():
            continue
        key = '/'.join(parts[1:4])
        if key != site:
            flush()
            site, files = key, {}
        ext = parts[-1].rsplit('.', 1)[-1]
        if ext in ('html', 'png', 'json') and m.size < 8_000_000:
            files[ext] = tar.extractfile(m).read()
        if meter.n > LIMIT_GB * 1e9 or all(v >= PER_CAT for v in count.values()):
            break
    flush()
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    print('Готово:', count, f'прочитано {meter.n / 1e9:.2f} ГБ')


if __name__ == '__main__':
    main()
