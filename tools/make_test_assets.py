"""Генерирует вымышленные реквизиты с правильными контрольными суммами и QR-коды для тестовых страниц.

Запуск: .venv\\Scripts\\python.exe tools\\make_test_assets.py
Картинки сохраняются в lab/pages/img и lab/scenarios/img. Все люди, организации и счета вымышлены.
"""
from pathlib import Path
import qrcode

ROOT = Path(__file__).resolve().parent.parent
BIC = '044599123'  # вымышленный БИК


def luhn_complete(prefix15):
    digits = [int(d) for d in prefix15]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 0:
            d *= 2
            d -= 9 if d > 9 else 0
        total += d
    return prefix15 + str((10 - total % 10) % 10)


def account_with_key(acc20, bic=BIC):
    """Подставляет контрольный ключ (9-я цифра счёта) по Порядку Банка России № 515."""
    acc = acc20[:8] + '0' + acc20[9:]
    tail = bic[-3:]
    prefix = '0' + bic[4:6] if tail in ('000', '001', '002') else tail
    s = sum((int(d) * w) % 10 for d, w in zip(prefix + acc, [7, 1, 3] * 8))
    key = (s % 10) * 3 % 10
    return acc[:8] + str(key) + acc[9:]


def inn10(prefix9):
    w = [2, 4, 10, 3, 5, 9, 4, 6, 8]
    return prefix9 + str(sum(int(d) * k for d, k in zip(prefix9, w)) % 11 % 10)


def gost(name, account, purpose, rub, inn=None):
    parts = ['ST00012', 'Name=' + name, 'PersonalAcc=' + account, 'BankName=АО «Банк Северный»', 'BIC=' + BIC,
             'CorrespAcc=30101810400000000123']
    if inn:
        parts.append('PayeeINN=' + inn)
    parts += ['Sum=' + str(int(rub * 100)), 'Purpose=' + purpose]
    return '|'.join(parts)


def save(text, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img = qrcode.make(text, box_size=6, border=3, error_correction=qrcode.constants.ERROR_CORRECT_M)
    img.save(path)
    print(path.relative_to(ROOT), '←', text[:70])


if __name__ == '__main__':
    org_acc = account_with_key('40702810500000012345')
    person_acc = account_with_key('40817810200000067890')
    deposit_acc = account_with_key('42301810700000054321')
    org_inn = inn10('770123456')
    print('Счёт организации', org_acc, '| счёт физлица', person_acc, '| вклад', deposit_acc, '| ИНН', org_inn)
    print('Карты:', luhn_complete('220220360041537'), luhn_complete('220015760392841'), luhn_complete('427601447736119'))

    pages = ROOT / 'lab' / 'pages' / 'img'
    legit = gost('ООО «УК Уютный дом»', org_acc, 'Оплата ЖКУ за октябрь, лицевой счёт 100245', 3950, org_inn)
    save(legit, pages / 'qr-legit.png')
    save(legit, ROOT / 'lab' / 'scenarios' / 'img' / 'receipt-qr.png')
    save(gost('Иванов Сергей Петрович', person_acc, 'Оплата ЖКУ', 4800), pages / 'qr-fake.png')
    save('https://qr-nspk.sbp-pay.online/AD10006M8KR1PQ2V9?type=02&sum=129000&cur=RUB', pages / 'qr-sbp-fake.png')

    sc = ROOT / 'lab' / 'scenarios' / 'img'
    save(gost('Кузнецова Анна Викторовна', person_acc, 'Штраф по постановлению 18810177260000123456', 2500), sc / 'fine-qr.png')
    save('https://qr.nspk.ru/AS10003P3RH0LJ2A9ROO038L6NT5RU1M?type=01&bank=100000000111&cur=RUB&crc=AB75', sc / 'cafe-sbp.png')
    save('https://qr.nspk.ru/BD20006M8KR1PQ2V9?type=02&sum=124000&cur=RUB&crc=1F2C', sc / 'shop-sbp.png')
