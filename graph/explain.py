"""Шаг 4. Объяснение обученной GraphSAGE: что она берёт из графа и за счёт чего работает.

Ничего не переобучает (кроме двух быстрых базовых моделей для кривых точность–полнота).
Результат: graph/models/explain.json — данные для вкладки «Как работает GraphSAGE» и «Результаты».

  1. Параметры сети: сколько весов в каждом слое (то, что сеть «выучила»).
  2. «Закрыть глаза» сети: качество, если убрать информацию об отправителях, получателях или обо всех соседях.
     Модель та же, просто на вход слоя подаём нули вместо среднего по соседям.
  3. Важность признаков: на сколько падает PR-AUC, если перемешать один признак между счетами.
  4. Кривые точность–полнота всех четырёх моделей на тестовой выборке.
  5. Что происходит на пороге «высокий риск»: сколько дропов найдено, сколько пропущено, сколько ложных тревог.
  6. Распределение оценок честных счетов и дропов.
  7. Пошаговый разбор одного настоящего тестового счёта: признаки → слой 1 → слой 2 → оценка.
  8. Две другие модели: веса логистической регрессии, важность признаков бустинга, решения всех моделей на пороге.
  9. Описание датасета (graph/data/dataset.json, его считает graph/dataset_stats.py).
Данные вписываются прямо в lab/graphsage.html — страница открывается и без лаборатории, на любом компьютере.
"""
from pathlib import Path
import json
import re
import time
import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, precision_recall_curve

from . import train as tr

OUT = tr.MODELS / 'explain.json'


def r(v, d=4):
    return round(float(v), d)


def forward(model, x, a_in, a_out, use_in=True, use_out=True, keep=False):
    """Прямой проход GraphSAGE с возможностью «закрыть» отправителей или получателей."""
    h, layers = x, []
    for layer in model.layers:
        parts = [layer.self_lin(h),
                 layer.in_lin(a_in @ h) if use_in else torch.zeros(h.shape[0], layer.in_lin.out_features),
                 layer.out_lin(a_out @ h) if use_out else torch.zeros(h.shape[0], layer.out_lin.out_features)]
        h = torch.relu(parts[0] + parts[1] + parts[2])
        if keep:
            layers.append((parts, h))
    logit = model.head(h).squeeze(-1)
    return (torch.sigmoid(logit), layers, logit) if keep else torch.sigmoid(logit)


def pr_points(y, s, n=90):
    p, rc, _ = precision_recall_curve(y, s)
    idx = np.unique(np.linspace(0, len(p) - 1, n).astype(int))
    return [[r(rc[i], 3), r(p[i], 3)] for i in idx]


def run(callback=None):
    say = (lambda m: (print(m, flush=True), callback and callback(m)))
    t0 = time.time()
    g = tr.load_graph()
    x, raw, y, edges = g['x'], g['raw'], g['y'].astype(np.int64), g['edges'].astype(np.int64)
    n = len(y)
    metrics = json.loads((tr.MODELS / 'metrics.json').read_text(encoding='utf-8'))
    p = metrics['params']
    s = np.load(tr.MODELS / 'scores.npz')
    prob, split = s['prob'], s['split']
    tr_m, va, te = split == 1, split == 2, split == 3
    names = [str(f) for f in g['feature_names']]
    thr = metrics['thresholds']

    model = tr.GraphSAGE(x.shape[1], p['hidden'], p['layers'], p['dropout'])
    model.load_state_dict(torch.load(tr.MODELS / 'graphsage.pt'))
    model.eval()
    a_in, a_out = tr.mean_adjacency(edges, n, False), tr.mean_adjacency(edges, n, True)
    xt = torch.tensor(x)

    # ---------- 1. параметры
    params = []
    for k, v in model.state_dict().items():
        params.append({'name': k, 'shape': list(v.shape), 'count': int(v.numel())})
    total = sum(q['count'] for q in params)
    say(f'Параметров в сети: {total}')

    # ---------- 2. «закрыть глаза»
    with torch.no_grad():
        base = forward(model, xt, a_in, a_out).numpy()
        ablation = []
        for title, ui, uo in [('Всё: счёт + отправители + получатели', True, True),
                              ('Без получателей (только кто присылал)', True, False),
                              ('Без отправителей (только кому пересылал)', False, True),
                              ('Без соседей: только признаки самого счёта', False, False)]:
            sc = base if (ui and uo) else forward(model, xt, a_in, a_out, ui, uo).numpy()
            ablation.append({'title': title, 'pr_auc': r(average_precision_score(y[te], sc[te]))})
    say('Вклад соседей: ' + ', '.join(f"{a['title']}: {a['pr_auc']}" for a in ablation))

    # ---------- 3. важность признаков (перестановка)
    rng = np.random.default_rng(0)
    base_ap = average_precision_score(y[te], base[te])
    importance = []
    with torch.no_grad():
        for j, name in enumerate(names):
            xp = x.copy()
            xp[:, j] = xp[rng.permutation(n), j]
            sc = forward(model, torch.tensor(xp), a_in, a_out).numpy()
            importance.append({'name': name, 'drop': r(base_ap - average_precision_score(y[te], sc[te]))})
    importance.sort(key=lambda q: -q['drop'])
    say('Самые важные признаки: ' + ', '.join(q['name'] for q in importance[:4]))

    # ---------- 4. кривые точность–полнота (быстро переобучаем две базовые модели на том же разбиении)
    say('Кривые точность–полнота: обучаю логистическую регрессию и бустинг заново (1–3 минуты)…')
    lr = LogisticRegression(class_weight='balanced', max_iter=500).fit(x[tr_m], y[tr_m])
    with torch.no_grad():
        xg = torch.cat([xt, a_in @ xt, a_out @ xt], 1).numpy()
    gb = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.1, class_weight='balanced', random_state=p['seed']).fit(xg[tr_m], y[tr_m])
    s_lr = lr.predict_proba(x)[:, 1]
    s_gb = gb.predict_proba(xg)[:, 1]
    curves = {
        'rule': pr_points(y[te], raw[te, 4]),
        'logreg': pr_points(y[te], s_lr[te]),
        'boosting': pr_points(y[te], s_gb[te]),
        'graphsage': pr_points(y[te], prob[te]),
    }

    # ---------- 8. две другие модели
    def at_best_f1(score):
        """Порог — максимум F1 на проверке (как «высокий риск» у GraphSAGE); итог считается на тесте."""
        pp, rr, tt = precision_recall_curve(y[va], score[va])
        f1 = (2 * pp * rr / np.maximum(pp + rr, 1e-9))[:-1]
        t = float(tt[int(np.argmax(f1))])
        pred, yt = score[te] >= t, y[te] == 1
        return {'threshold': r(t), 'tp': int((pred & yt).sum()), 'fp': int((pred & ~yt).sum()),
                'fn': int((~pred & yt).sum()), 'tn': int((~pred & ~yt).sum())}
    say('Важность признаков бустинга (перестановка каждого из 51 признака)…')
    gb_names = names + ['отправители: ' + q for q in names] + ['получатели: ' + q for q in names]
    base_gb = average_precision_score(y[te], s_gb[te])
    gb_imp = []
    for j, name in enumerate(gb_names):
        xp = xg[te].copy()
        xp[:, j] = xp[rng.permutation(len(xp)), j]
        gb_imp.append({'name': name, 'group': ['свой', 'отправители', 'получатели'][j // len(names)],
                       'drop': r(base_gb - average_precision_score(y[te], gb.predict_proba(xp)[:, 1]))})
    gb_imp.sort(key=lambda q: -q['drop'])
    sizes = {k: {'accounts': int(m.sum()), 'drops': int(y[m].sum())} for k, m in (('train', tr_m), ('val', va), ('test', te))}
    models_extra = {
        'sizes': sizes,
        'logreg': {'coef': [r(c) for c in lr.coef_[0]], 'intercept': r(lr.intercept_[0]), 'iterations': int(lr.n_iter_[0]),
                   'at': at_best_f1(s_lr)},
        'boosting': {'trees': int(gb.n_iter_), 'max_iter': 300, 'importance': gb_imp, 'features': len(gb_names),
                     'at': at_best_f1(s_gb)},
        'rule': {'at': at_best_f1(raw[:, 4].astype(float))},
    }

    # ---------- 5. порог
    def confusion(t):
        pred = prob[te] >= t
        yt = y[te] == 1
        return {'threshold': r(t), 'tp': int((pred & yt).sum()), 'fp': int((pred & ~yt).sum()),
                'fn': int((~pred & yt).sum()), 'tn': int((~pred & ~yt).sum())}
    at = {'high': confusion(thr['high']), 'elevated': confusion(thr['elevated'])}

    # ---------- 6. распределение оценок (логарифмические корзины)
    bins = np.concatenate([[0], np.logspace(-3, 0, 25)])
    hist = {'bins': [r(b, 5) for b in bins],
            'honest': np.histogram(prob[te & (y == 0)], bins)[0].tolist(),
            'drop': np.histogram(prob[te & (y == 1)], bins)[0].tolist()}

    # ---------- 7. разбор одного счёта
    e_src, e_dst = edges[:, 0], edges[:, 1]
    indeg = np.bincount(e_dst, minlength=n)
    outdeg = np.bincount(e_src, minlength=n)
    cand = np.where(te & (y == 1) & (prob >= thr['high']) & (indeg >= 3) & (indeg <= 7) & (outdeg >= 1) & (outdeg <= 3))[0]
    if not len(cand):
        cand = np.where(te & (y == 1) & (prob >= thr['high']))[0]
    i = int(cand[np.argmax(prob[cand])])
    senders = e_src[e_dst == i]
    receivers = e_dst[e_src == i]
    with torch.no_grad():
        sc_full, layers, logit = forward(model, xt, a_in, a_out, keep=True)
        sc_no_in = forward(model, xt, a_in, a_out, False, True)
        sc_no_out = forward(model, xt, a_in, a_out, True, False)
        sc_none = forward(model, xt, a_in, a_out, False, False)
    iso_x, iso_y = None, None
    # калибровка: повторяем изотоническую регрессию из train.py, чтобы перевести сырые оценки в вероятности
    from sklearn.isotonic import IsotonicRegression
    iso = IsotonicRegression(out_of_bounds='clip', y_min=0, y_max=1).fit(s['scores'][va], y[va])
    cal = lambda v: r(iso.predict([float(v)])[0])
    two_hop = set()
    for j in np.concatenate([senders, receivers]):
        two_hop |= set(e_src[e_dst == j].tolist()) | set(e_dst[e_src == j].tolist())
    two_hop -= {i}
    two_hop -= set(senders.tolist()) | set(receivers.tolist())
    layer_info = []
    for k, (parts, h) in enumerate(layers):
        layer_info.append({
            'self_norm': r(parts[0][i].norm()), 'in_norm': r(parts[1][i].norm()), 'out_norm': r(parts[2][i].norm()),
            'h': [r(v, 3) for v in h[i].tolist()], 'active': int((h[i] > 0).sum()),
        })
    keys = g['keys']
    nb = lambda arr: [{'account': str(keys[j]), 'raw': [r(v, 3) for v in raw[j]], 'prob': r(prob[j]), 'label': int(y[j])} for j in arr[:8]]
    example = {
        'account': str(keys[i]), 'label': int(y[i]),
        'raw': [r(v, 3) for v in raw[i]], 'x': [r(v, 3) for v in x[i]],
        'senders': nb(senders), 'receivers': nb(receivers),
        'n_senders': int(len(senders)), 'n_receivers': int(len(receivers)), 'n_two_hop': len(two_hop),
        'mean_senders_raw': [r(v, 3) for v in raw[senders].mean(0)] if len(senders) else None,
        'mean_receivers_raw': [r(v, 3) for v in raw[receivers].mean(0)] if len(receivers) else None,
        'layers': layer_info, 'logit': r(logit[i]), 'raw_score': r(sc_full[i]), 'prob': r(prob[i]),
        'what_if': {'no_senders': cal(sc_no_in[i]), 'no_receivers': cal(sc_no_out[i]), 'no_neighbors': cal(sc_none[i]), 'full': r(prob[i])},
        # тот же счёт глазами двух других моделей; у регрессии — вклад каждого признака (вес × значение)
        'logreg_score': r(s_lr[i]), 'boosting_score': r(s_gb[i]),
        'logreg_terms': sorted([{'name': names[j], 'x': r(x[i, j], 3), 'w': r(lr.coef_[0][j], 3), 'term': r(lr.coef_[0][j] * x[i, j], 3)}
                                for j in range(len(names))], key=lambda q: -abs(q['term']))[:8],
    }
    say(f'Пример счёта {example["account"]}: вероятность {example["prob"]}, без соседей {example["what_if"]["no_neighbors"]}')

    out = {'built_at': time.strftime('%Y-%m-%d %H:%M'), 'params': params, 'params_total': total, 'hyper': p,
           'ablation': ablation, 'importance': importance, 'curves': curves,
           'base_rate': r(y[te].mean()), 'at_threshold': at, 'hist': hist, 'example': example,
           'feature_names': names, 'typical': metrics['typical'], 'models_extra': models_extra}
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    # Те же числа — для учебника lab/graphsage.html: он открывается и без сервера, поэтому данные лежат рядом в .js.
    guide = dict(out, metrics={k: metrics[k] for k in ('models', 'thresholds', 'curve', 'dataset', 'params', 'trained_at')})
    ds_file = tr.ROOT / 'data' / 'dataset.json'
    if not ds_file.exists():
        from . import dataset_stats
        dataset_stats.run(callback)
    guide['source'] = json.loads(ds_file.read_text(encoding='utf-8'))
    write_guide(guide)
    say(f'Готово за {time.time() - t0:.0f} с.')
    return out


def write_guide(guide):
    """Вписать данные прямо в lab/graphsage.html между метками GUIDE-DATA: страница открывается без лаборатории
    (двойным щелчком, на другом компьютере) и всё равно показывает все таблицы и графики."""
    page = tr.ROOT.parent / 'lab' / 'graphsage.html'
    html = page.read_text(encoding='utf-8')
    data = json.dumps(guide, ensure_ascii=False).replace('</', '<' + chr(92) + '/')
    block = ('<script id="guide-data">/* GUIDE-DATA: создано graph/explain.py ' + time.strftime('%Y-%m-%d %H:%M') +
             ' — не править вручную */' + chr(10) + 'window.GUIDE_DATA = ' + data + ';' + chr(10) + '</script>')
    html, k = re.subn(r'<script id="guide-data">.*?</script>', lambda m: block, html, flags=re.S)
    if not k:
        raise RuntimeError('В lab/graphsage.html нет блока <script id="guide-data">')
    page.write_text(html, encoding='utf-8')


if __name__ == '__main__':
    run()
