"""Шаг 3. Исследование: что модель «понимает» о схемах отмывания.

Использует дополнительные файлы датасета IBM AMLworld:
  HI-Small_Patterns.txt — 370 размеченных операций отмывания по 8 схемам (веер, цикл, ...);
  HI-Small_accounts.csv — владелец каждого счёта (компания, партнёрство, ИП, частное лицо) и страна банка.
Результат: graph/models/research.json — данные для вкладки «Исследование схем».

  1. По схемам: насколько хорошо GraphSAGE распознаёт получателей в каждой схеме (только тестовые счета).
  2. Карта эмбеддингов: внутренние представления счетов (64 числа) сжимаются t-SNE в 2D —
     видно, где нейросеть «размещает» дропов относительно честных счетов.
  3. Владельцы: доля дропов среди счетов разных типов владельцев и при переводах между странами.
"""
from pathlib import Path
import json
import re
import time
import numpy as np
import pandas as pd
import torch
from sklearn.manifold import TSNE

from . import prepare as prep
from . import train as tr

PATTERNS = prep.CSV.parent / 'HI-Small_Patterns.txt'
ACCOUNTS = prep.CSV.parent / 'HI-Small_accounts.csv'
OUT = tr.MODELS / 'research.json'

TYPES = {
    'FAN-IN': ('Веер на вход', 'Много счетов переводят на один — типичный «дроп», собирающий деньги жертв.'),
    'FAN-OUT': ('Веер на выход', 'Один счёт рассылает деньги на много счетов — дробление суммы.'),
    'CYCLE': ('Цикл', 'Деньги проходят по кругу через несколько счетов и возвращаются — запутывание следов.'),
    'SCATTER-GATHER': ('Разброс-сбор', 'Деньги расходятся по посредникам и снова собираются на одном счёте.'),
    'GATHER-SCATTER': ('Сбор-разброс', 'Деньги собираются на одном счёте и затем расходятся по многим.'),
    'BIPARTITE': ('Двудольная', 'Группа счетов-источников переводит группе счетов-получателей.'),
    'STACK': ('Стопка', 'Несколько слоёв посредников, деньги идут «этажами».'),
    'RANDOM': ('Случайная', 'Цепочка переводов без чёткой формы.'),
}


def parse_patterns():
    attempts, cur = [], None
    for line in PATTERNS.read_text(encoding='utf-8').splitlines():
        if line.startswith('BEGIN LAUNDERING ATTEMPT'):
            m = re.match(r'BEGIN LAUNDERING ATTEMPT - ([A-Z-]+):?\s*(.*)', line)
            cur = {'id': len(attempts), 'type': m.group(1), 'detail': m.group(2).strip(), 'txns': []}
        elif line.startswith('END LAUNDERING ATTEMPT'):
            attempts.append(cur); cur = None
        elif cur is not None and line[:2] == '20':
            f = line.split(',')
            cur['txns'].append({'t': f[0], 'from': f[1] + ':' + f[2], 'to': f[3] + ':' + f[4],
                                'amount': float(f[5]), 'currency': f[6], 'format': f[9]})
    return attempts


def embeddings(g, params):
    """Выход последнего слоя GraphSAGE перед классификатором — «как сеть видит счёт»."""
    model = tr.GraphSAGE(g['x'].shape[1], params['hidden'], params['layers'], params['dropout'])
    model.load_state_dict(torch.load(tr.MODELS / 'graphsage.pt'))
    model.eval()
    edges = g['edges'].astype(np.int64)
    n = len(g['y'])
    a_in, a_out = tr.mean_adjacency(edges, n, False), tr.mean_adjacency(edges, n, True)
    h = torch.tensor(g['x'])
    with torch.no_grad():
        for layer in model.layers:
            h = torch.relu(layer(h, a_in, a_out))
    return h.numpy()


def run(callback=None):
    say = (lambda m: (print(m, flush=True), callback and callback(m)))
    t0 = time.time()
    g = tr.load_graph()
    s = np.load(tr.MODELS / 'scores.npz')
    metrics = json.loads((tr.MODELS / 'metrics.json').read_text(encoding='utf-8'))
    prob, split, y = s['prob'], s['split'], g['y']
    thr = metrics['thresholds']['high']
    index = {k: i for i, k in enumerate(g['keys'])}

    # ---------- 1. схемы
    attempts = parse_patterns()
    say(f'Схем отмывания в файле: {len(attempts)}')
    by_type = {}
    acc_type = {}
    for a in attempts:
        receivers = {index[t['to']] for t in a['txns'] if t['to'] in index}
        accounts = receivers | {index[t['from']] for t in a['txns'] if t['from'] in index}
        a['accounts'] = sorted(accounts)
        for i in accounts:
            acc_type.setdefault(int(i), a['type'])
        st = by_type.setdefault(a['type'], {'attempts': 0, 'txns': 0, 'receivers': set(), 'sizes': []})
        st['attempts'] += 1; st['txns'] += len(a['txns']); st['receivers'] |= receivers; st['sizes'].append(len(accounts))
    types = []
    for code, st in by_type.items():
        rec = np.array(sorted(st['receivers']))
        test = rec[split[rec] == 3]
        types.append({
            'code': code, 'name': TYPES[code][0], 'about': TYPES[code][1],
            'attempts': st['attempts'], 'txns': st['txns'], 'receivers': int(len(rec)),
            'median_size': float(np.median(st['sizes'])),
            'test_receivers': int(len(test)),
            'test_recall': float((prob[test] >= thr).mean()) if len(test) else None,
            'mean_prob_all': float(prob[rec].mean()),
        })
    types.sort(key=lambda t: -(t['test_recall'] or 0))
    for t in types:
        say(f"  {t['name']}: получателей в тесте {t['test_receivers']}, найдено {t['test_recall']:.0%}" if t['test_recall'] is not None else t['name'])

    # ---------- 2. карта эмбеддингов (t-SNE)
    say('Считаю внутренние представления GraphSAGE и строю карту t-SNE (около минуты)…')
    emb = embeddings(g, metrics['params'])
    rng = np.random.default_rng(1)
    te = np.where(split == 3)[0]
    pos = te[y[te] == 1]
    neg = rng.choice(te[y[te] == 0], size=min(3500, int((y[te] == 0).sum())), replace=False)
    idx = np.concatenate([pos, neg])
    xy = TSNE(n_components=2, perplexity=35, init='pca', random_state=1).fit_transform(emb[idx])
    xy = (xy - xy.min(0)) / (xy.max(0) - xy.min(0))
    points = [{'x': round(float(a), 4), 'y': round(float(b), 4), 'label': int(y[i]), 'prob': round(float(prob[i]), 4),
               'account': str(g['keys'][i]), 'type': acc_type.get(int(i))} for (a, b), i in zip(xy, idx)]

    # ---------- 3. владельцы и страны
    say('Анализ владельцев счетов…')
    acc = pd.read_csv(ACCOUNTS, dtype=str)
    acc['key_num'] = acc['Bank ID'].astype(int).astype(str) + ':' + acc['Account Number']
    acc['entity'] = acc['Entity Name'].str.replace(r'\s*#\d+', '', regex=True)
    acc['country'] = acc['Bank Name'].str.replace(r'\s*Bank\s*#\d+', '', regex=True)
    keys = pd.Series(g['keys']).str.split(':', expand=True)
    key_num = keys[0].astype(int).astype(str) + ':' + keys[1]
    info = pd.DataFrame({'key_num': key_num, 'y': y, 'recipient': g['raw'][:, 0] > 0}).merge(
        acc[['key_num', 'entity', 'country']].drop_duplicates('key_num'), on='key_num', how='left')
    r = info[info['recipient']]
    ent = r.groupby('entity')['y'].agg(['mean', 'sum', 'count']).sort_values('count', ascending=False)
    entities = [{'name': k, 'rate': float(v['mean']), 'illicit': int(v['sum']), 'total': int(v['count'])} for k, v in ent.iterrows() if v['count'] >= 50]
    ENT_RU = {'Partnership': 'Партнёрство', 'Corporation': 'Корпорация', 'Sole Proprietorship': 'Индивидуальный предприниматель',
              'Individual': 'Частное лицо', 'Country': 'Государственный счёт', 'Direct': 'Прямой счёт'}
    for e in entities:
        e['name_ru'] = ENT_RU.get(e['name'], e['name'])
    matched = float(info['entity'].notna().mean())

    out = {'built_at': time.strftime('%Y-%m-%d %H:%M'), 'threshold': thr, 'types': types,
           'patterns': [{'id': a['id'], 'type': a['type'], 'detail': a['detail'], 'n_txns': len(a['txns']), 'n_accounts': len(a['accounts'])} for a in attempts],
           'map': points, 'entities': entities, 'accounts_matched': matched,
           'pattern_share': {'in_patterns': int(sum(t['txns'] for t in types)), 'all_illicit_txns': None}}
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    (tr.MODELS / 'patterns.json').write_text(json.dumps(attempts, ensure_ascii=False), encoding='utf-8')
    say(f'Готово за {time.time() - t0:.0f} с.')
    return out


if __name__ == '__main__':
    run()
