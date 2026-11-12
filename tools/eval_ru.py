"""Русские настоящие страницы для оценки ложных тревог (законные сайты, где тревоги быть не должно).

Подобраны так, чтобы проверить слабые места старых правил:
  - новости и памятки о мошенничестве — в тексте фразы «безопасный счёт», «код из SMS», «переведите»;
  - страницы «Как оплатить» магазинов — «оплата через СБП», контактные телефоны;
  - реквизиты благотворительных фондов — счёт организации, перевод по СБП;
  - обычные главные страницы банков и сервисов.
Сохраняется только HTML (скрипты при оценке не выполняются). Результат: datasets/web_pages/eval_sample/ru/.

Запуск: .venv\\Scripts\\python.exe tools\\eval_ru.py
"""
from pathlib import Path
import json
import re
import urllib.request

OUT = Path(__file__).resolve().parent.parent.parent / 'datasets' / 'web_pages' / 'eval_sample' / 'ru'
CSP = "default-src 'none'; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data:"
PAGES = [
    ('новость/памятка', 'https://journal.sovcombank.ru/news/krasnaya-lampochka-dlya-raspoznavaniya-telefonnogo-moshennika'),
    ('новость/памятка', 'https://finuslugi.ru/navigator/kak-ehto-rabotaet/stat_kak-moshenniki-kradut-dengi-pri-perevodakh-v-2026-godu'),
    ('новость/памятка', 'https://evening-kazan.ru/obshhestvo/news/vasenin-nikakih-bezopasnyh-schetov-o-kotoryh-govoryat-moshenniki-ne-sushchestvuet'),
    ('новость/памятка', 'https://finance.mail.ru/article/novye-moshennicheskie-skhemy-69208441/'),
    ('новость/памятка', 'https://finance.mail.ru/article/ekspert-nazval-glavnye-frazy-moshennikov-v-2026-godu-69204923/'),
    ('новость/памятка', 'https://riamo.ru/news/obschestvo/ekspert-ozvuchil-bazovyj-chek-list-dlja-zaschity-ot-kibermoshennikov-v-2026-godu/'),
    ('новость/памятка', 'https://altapress.ru/story/samie-populyarnie-finansovie-shemi-moshennikov-v-godu-387564'),
    ('новость/памятка', 'https://www.bfm.ru/news/436218'),
    ('новость/памятка', 'https://peterburg2.ru/news/kak-moshenniki-ispolzuyut-sms-dlya-krazhi-deneg-i-dannyh-220783.html'),
    ('новость/памятка', 'https://www.zakon.kz/proisshestviia/6523457-perevela-na-bezopasnyy-schet-bolee-2-mln-tenge-poteryala-zhitelnitsa-oblasti-abay.html'),
    ('новость/памятка', 'https://xn--h1alcedd.xn--d1aqf.xn--p1ai/instructions/populyarnye-skhemy-moshennikov-i-sposoby-zashchity-ot-nikh/'),
    ('новость/памятка', 'https://www.cbr.ru/information_security/pmp/'),
    ('новость/памятка', 'https://habr.com/ru/post/475326'),
    ('оплата в магазине', 'https://doctorhead.ru/kak-oplatit/'),
    ('оплата в магазине', 'https://www.citilink.ru/help/pay/'),
    ('оплата в магазине', 'https://t-j.ru/good-sbp/'),
    ('оплата в магазине', 'https://robokassa.com/payments/payment-method/sbp/'),
    ('реквизиты фонда', 'https://kontur.ru/bf-help/donate'),
    ('реквизиты фонда', 'https://vk.ru/@bud_onkogroup-kak-nam-pomoch'),
    ('реквизиты фонда', 'https://robokassa.com/solutions/business/blagotvoritelnost/'),
    ('главная страница', 'https://www.sberbank.ru/ru/person'),
    ('главная страница', 'https://www.tbank.ru/'),
    ('главная страница', 'https://www.avito.ru/'),
    ('главная страница', 'https://www.gosuslugi.ru/'),
    ('главная страница', 'https://ru.wikipedia.org/wiki/%D0%A4%D0%B8%D1%88%D0%B8%D0%BD%D0%B3'),
    ('главная страница', 'https://ru.wikipedia.org/wiki/%D0%A1%D0%B8%D1%81%D1%82%D0%B5%D0%BC%D0%B0_%D0%B1%D1%8B%D1%81%D1%82%D1%80%D1%8B%D1%85_%D0%BF%D0%BB%D0%B0%D1%82%D0%B5%D0%B6%D0%B5%D0%B9'),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for k, (kind, url) in enumerate(PAGES):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
                                                       'Accept-Language': 'ru-RU,ru;q=0.9'})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                enc = r.headers.get_content_charset() or 'utf-8'
            html = raw.decode(enc, errors='replace')
        except Exception as e:
            print('не скачалось:', url, e)
            continue
        if len(html) < 2000:
            print('слишком мало HTML (вероятно, защита от роботов):', url)
            continue
        meta = f'<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{CSP}">'
        m = re.search(r'<head[^>]*>', html, re.I)
        html = html[:m.end()] + meta + html[m.end():] if m else meta + html
        (OUT / f'{k}.html').write_text(html, encoding='utf-8')
        index.append({'file': f'{k}.html', 'label': 'legit', 'kind': kind, 'url': url})
        print('ok', kind, url)
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    print('сохранено', len(index), 'из', len(PAGES))


if __name__ == '__main__':
    main()
