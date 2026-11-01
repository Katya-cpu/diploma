"""Шаг 1. Подготовка графа из датасета IBM AMLworld (HI-Small).

Вход:  datasets/ibm_aml/HI-Small_Trans.csv — 5 078 345 синтетических банковских переводов
       (Altman et al., «Realistic Synthetic Financial Transactions for Anti-Money Laundering Models», NeurIPS 2023).
Выход: graph/data/graph.npz — граф счетов и признаки каждого счёта.

Как устроен граф:
  вершина  = банковский счёт (банк + номер счёта);
  ребро    = «со счёта A хотя бы раз переводили на счёт B»;
  признаки = статистика переводов счёта (сколько, от скольких отправителей, на какие суммы, каким способом...).
Метка счёта = «на этот счёт приходил перевод, отмеченный в датасете как отмывание» (Is Laundering = 1).
Метка НЕ используется при расчёте признаков — только как правильный ответ для обучения и проверки.
"""
from pathlib import Path
import time
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
CSV = ROOT.parent.parent / 'datasets' / 'ibm_aml' / 'HI-Small_Trans.csv'
OUT = ROOT / 'data' / 'graph.npz'

# Примерные курсы к доллару США (2022 г.), чтобы суммы в разных валютах были сравнимы.
USD_RATE = {
    'US Dollar': 1.0, 'Euro': 1.0, 'UK Pound': 1.17, 'Swiss Franc': 1.03, 'Canadian Dollar': 0.75,
    'Australian Dollar': 0.68, 'Yuan': 0.145, 'Yen': 0.0071, 'Rupee': 0.0125, 'Ruble': 0.017,
    'Shekel': 0.29, 'Mexican Peso': 0.05, 'Brazil Real': 0.19, 'Saudi Riyal': 0.27, 'Bitcoin': 20000.0,
}
FORMATS = ['ACH', 'Bitcoin', 'Cash', 'Cheque', 'Credit Card', 'Reinvestment', 'Wire']

# Названия признаков — показываются в лаборатории.
FEATURE_NAMES = [
    'входящих переводов', 'исходящих переводов', 'сумма входящих, $', 'сумма исходящих, $',
    'разных отправителей', 'разных получателей', 'доля пересланного дальше',
    'пересылка в течение суток после поступления', 'дней активности', 'разных валют на входе',
] + ['доля входящих: ' + f for f in FORMATS]


def num(v):
    return f'{v:,}'.replace(',', ' ')


def log(msg, callback=None):
    print(msg, flush=True)
    if callback:
        callback(msg)


def prepare(callback=None):
    t0 = time.time()
    if not CSV.exists():
        raise FileNotFoundError(f'Нет файла датасета: {CSV}. Скачайте его кнопкой «Скачать датасет».')
    log('Читаю CSV (5 млн строк, около минуты)…', callback)
    df = pd.read_csv(CSV, dtype={'From Bank': str, 'Account': str, 'To Bank': str, 'Account.1': str,
                                 'Receiving Currency': 'category', 'Payment Format': 'category'},
                     usecols=['Timestamp', 'From Bank', 'Account', 'To Bank', 'Account.1', 'Amount Received',
                              'Receiving Currency', 'Payment Format', 'Is Laundering'])
    total_rows = len(df)
    src_key = df['From Bank'] + ':' + df['Account']
    dst_key = df['To Bank'] + ':' + df['Account.1']
    codes, keys = pd.factorize(pd.concat([src_key, dst_key], ignore_index=True))
    keys = np.asarray(keys, dtype=str)
    n = len(keys)
    src = codes[:total_rows].astype(np.int64)
    dst = codes[total_rows:].astype(np.int64)
    del src_key, dst_key, codes

    log(f'Счетов: {num(n)}. Считаю признаки…', callback)
    # Минуты от начала датасета. Считаем через разность дат, а не через внутреннее целое представление:
    # оно зависит от версии pandas (нано- или микросекунды).
    ts = pd.to_datetime(df['Timestamp'], format='%Y/%m/%d %H:%M')
    minutes = ((ts - ts.min()).dt.total_seconds() // 60).astype(np.int64).to_numpy().copy()
    usd = df['Amount Received'].to_numpy() * df['Receiving Currency'].map(USD_RATE).astype(float).to_numpy()
    fmt = df['Payment Format'].map({f: i for i, f in enumerate(FORMATS)}).astype(int).to_numpy()
    cur = df['Receiving Currency'].cat.codes.to_numpy()
    illicit = df['Is Laundering'].to_numpy().astype(bool)
    del df

    # Переводы самому себе (реинвестирование) не связывают разные счета — исключаем.
    keep = src != dst
    src, dst, minutes, usd, fmt, cur, illicit = src[keep], dst[keep], minutes[keep], usd[keep], fmt[keep], cur[keep], illicit[keep]

    in_cnt = np.bincount(dst, minlength=n)
    out_cnt = np.bincount(src, minlength=n)
    in_sum = np.bincount(dst, weights=usd, minlength=n)
    out_sum = np.bincount(src, weights=usd, minlength=n)
    pairs = np.unique(np.stack([src, dst], 1), axis=0)          # уникальные рёбра A→B
    uniq_senders = np.bincount(pairs[:, 1], minlength=n)
    uniq_receivers = np.bincount(pairs[:, 0], minlength=n)
    pass_ratio = np.where(in_sum > 0, np.minimum(out_sum / np.maximum(in_sum, 1e-9), 5.0), 0.0)

    # Время первого поступления → доля исходящих переводов в течение суток после него (признак «транзитного» счёта).
    first_in = np.full(n, np.iinfo(np.int64).max)
    np.minimum.at(first_in, dst, minutes)
    after = minutes - first_in[src]
    quick = (after >= 0) & (after <= 24 * 60)
    quick_share = np.where(out_cnt > 0, np.bincount(src, weights=quick, minlength=n) / np.maximum(out_cnt, 1), 0.0)

    t_min = np.full(n, np.iinfo(np.int64).max); t_max = np.zeros(n, dtype=np.int64)
    np.minimum.at(t_min, src, minutes); np.minimum.at(t_min, dst, minutes)
    np.maximum.at(t_max, src, minutes); np.maximum.at(t_max, dst, minutes)
    days = np.where(t_max >= t_min, (t_max - t_min) / (24 * 60), 0.0)

    cur_pairs = np.unique(np.stack([dst, cur], 1), axis=0)
    n_cur = np.bincount(cur_pairs[:, 0], minlength=n)
    fmt_share = np.zeros((n, len(FORMATS)))
    np.add.at(fmt_share, (dst, fmt), 1)
    fmt_share = fmt_share / np.maximum(in_cnt, 1)[:, None]

    raw = np.column_stack([in_cnt, out_cnt, in_sum, out_sum, uniq_senders, uniq_receivers, pass_ratio,
                           quick_share, days, n_cur, fmt_share]).astype(np.float32)
    # Для модели: логарифм от счётчиков и сумм (они различаются на порядки), затем стандартизация.
    x = raw.copy()
    for j in (0, 1, 2, 3, 4, 5, 8):
        x[:, j] = np.log1p(x[:, j])
    x = (x - x.mean(0)) / (x.std(0) + 1e-6)

    # Метка: счёт получал перевод с пометкой «отмывание».
    y = np.zeros(n, dtype=np.int8)
    y[np.unique(dst[illicit])] = 1

    OUT.parent.mkdir(exist_ok=True)
    np.savez_compressed(OUT, keys=keys.astype('U24'), x=x, raw=raw, y=y, edges=pairs.astype(np.int32),
                        feature_names=np.array(FEATURE_NAMES), rows=total_rows)
    recipients = int((in_cnt > 0).sum())
    log(f'Готово за {time.time() - t0:.0f} с: {num(n)} счетов, {num(len(pairs))} связей, получателей {num(recipients)}, '
        f'из них с меткой «отмывание» {num(int(y.sum()))} ({y[in_cnt > 0].mean() * 100:.2f} %).', callback)
    return OUT


if __name__ == '__main__':
    prepare()
