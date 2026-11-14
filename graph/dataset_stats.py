"""Описание исходного датасета IBM AMLworld (HI-Small) для учебника lab/graphsage.html.

Читает CSV целиком (все 11 столбцов) и считает: период, число банков и счетов, распределение валют и способов оплаты,
долю переводов с меткой «отмывание», пропуски, полные дубликаты, переводы самому себе, переводы с конвертацией валюты.
Результат: graph/data/dataset.json. Запуск: python -m graph.dataset_stats (из папки product). Около двух минут.
"""
import json
import time
import pandas as pd

from . import prepare as prep

OUT = prep.ROOT / 'data' / 'dataset.json'


def run(callback=None):
    t0 = time.time()
    say = (lambda m: (print(m, flush=True), callback and callback(m)))
    say('Читаю CSV целиком для описания датасета…')
    df = pd.read_csv(prep.CSV, dtype={'From Bank': str, 'Account': str, 'To Bank': str, 'Account.1': str})
    n = len(df)
    cols = list(pd.read_csv(prep.CSV, nrows=0).columns)  # имена как в файле (второй «Account» pandas переименовывает в Account.1)
    ts = pd.to_datetime(df['Timestamp'], format='%Y/%m/%d %H:%M')
    src = df['From Bank'] + ':' + df['Account']
    dst = df['To Bank'] + ':' + df['Account.1']
    ill = df['Is Laundering'] == 1
    self_tx = src == dst
    conv = df['Receiving Currency'] != df['Payment Currency']

    def dist(col, top=None):
        vc = df[col].value_counts()
        il = df.loc[ill, col].value_counts()
        rows = [{'name': str(k), 'rows': int(v), 'illicit': int(il.get(k, 0))} for k, v in vc.items()]
        return rows[:top] if top else rows

    sample_idx = list(df.index[~self_tx][:3]) + list(df.index[ill][:2])
    sample = df.loc[sample_idx].astype(str).values.tolist()
    out = {
        'file': prep.CSV.name, 'size_mb': round(prep.CSV.stat().st_size / 2**20), 'rows': int(n), 'columns': cols,
        'period': [str(ts.min()), str(ts.max())], 'days': round((ts.max() - ts.min()).total_seconds() / 86400, 1),
        'banks': int(pd.concat([df['From Bank'], df['To Bank']]).nunique()),
        'accounts': int(pd.concat([src, dst]).nunique()),
        'illicit_rows': int(ill.sum()),
        'missing': {c: int(v) for c, v in df.isna().sum().items()},
        'duplicates': int(df.duplicated().sum()),
        'self_transfers': int(self_tx.sum()), 'self_transfers_illicit': int((self_tx & ill).sum()),
        'converted': int(conv.sum()),
        'amount_received': {q: round(float(df['Amount Received'].quantile(v)), 2) for q, v in [('min', 0), ('median', 0.5), ('p99', 0.99), ('max', 1)]},
        'currencies': dist('Receiving Currency'), 'formats': dist('Payment Format'),
        'by_day': [{'day': str(d.date()), 'rows': int(v), 'illicit': int(ill[ts.dt.normalize() == d].sum())}
                   for d, v in ts.dt.normalize().value_counts().sort_index().items()],
        'sample': sample,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    say(f'Описание датасета готово за {time.time() - t0:.0f} с: {n} строк, отмывание {out["illicit_rows"]}.')
    return out


if __name__ == '__main__':
    run()
