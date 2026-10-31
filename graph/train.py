"""Шаг 2. Обучение и сравнение моделей оценки риска счёта-получателя.

Задача: по истории переводов предсказать, используется ли счёт для приёма «грязных» денег
(в датасете — получал перевод с меткой отмывания). Такие счета-получатели в России называют «дропами».

Сравниваются четыре подхода — от самого простого к графовой нейросети:
  1. Правило: «много разных отправителей» (одна цифра, без обучения);
  2. Логистическая регрессия по собственным признакам счёта;
  3. Градиентный бустинг по признакам счёта + усреднённым признакам его соседей по графу;
  4. GraphSAGE — графовая нейросеть (Hamilton et al., 2017), которая сама учится собирать
     информацию от отправителей и получателей счёта.

Проверка честная: счета-получатели случайно делятся на обучающие (70 %), проверочные (15 %, подбор порога)
и тестовые (15 %, итоговые метрики). На тестовых счетах модель не обучалась.
"""
from pathlib import Path
import json
import time
import warnings
import numpy as np
import torch
from torch import nn
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, roc_auc_score, precision_recall_curve

warnings.filterwarnings('ignore', category=UserWarning)  # бета-предупреждения PyTorch о разреженных матрицах
ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'graph.npz'
MODELS = ROOT / 'models'

DEFAULTS = {'epochs': 300, 'hidden': 64, 'layers': 2, 'lr': 0.02, 'dropout': 0.2, 'seed': 42}
MODEL_TITLES = {
    'rule': 'Правило: много разных отправителей',
    'logreg': 'Логистическая регрессия (признаки счёта)',
    'boosting': 'Градиентный бустинг (признаки счёта + соседей)',
    'graphsage': 'GraphSAGE — графовая нейросеть',
}


# ---------------------------------------------------------------- данные
def load_graph():
    d = np.load(DATA)
    return {k: d[k] for k in d.files}


def make_split(y, candidates, seed):
    """Стратифицированное разбиение счетов-получателей: 0 — не участвует, 1 — обучение, 2 — проверка, 3 — тест."""
    rng = np.random.default_rng(seed)
    split = np.zeros(len(y), dtype=np.int8)
    for cls in (0, 1):
        idx = np.where(candidates & (y == cls))[0]
        rng.shuffle(idx)
        a, b = int(len(idx) * 0.70), int(len(idx) * 0.85)
        split[idx[:a]], split[idx[a:b]], split[idx[b:]] = 1, 2, 3
    return split


def mean_adjacency(edges, n, reverse):
    """Матрица усреднения по соседям: строка v = 1/степень для каждого соседа v."""
    rows, cols = (edges[:, 1], edges[:, 0]) if not reverse else (edges[:, 0], edges[:, 1])
    deg = np.bincount(rows, minlength=n).astype(np.float32)
    vals = 1.0 / np.maximum(deg[rows], 1)
    idx = torch.tensor(np.stack([rows, cols]), dtype=torch.long)
    return torch.sparse_coo_tensor(idx, torch.tensor(vals), (n, n)).coalesce().to_sparse_csr()


# ---------------------------------------------------------------- метрики
def evaluate(y, s):
    """PR-AUC — главная метрика при редком классе; ROC-AUC; полнота при 1 % ложных тревог; точность топ-100."""
    neg = s[y == 0]
    thr_1 = np.quantile(neg, 0.99)
    top = np.argsort(-s)[:100]
    p, r, t = precision_recall_curve(y, s)
    f1 = (2 * p * r / np.maximum(p + r, 1e-9))[:-1]
    return {
        'pr_auc': float(average_precision_score(y, s)),
        'roc_auc': float(roc_auc_score(y, s)),
        'recall_at_1fpr': float((s[y == 1] > thr_1).mean()),
        'precision_top100': float(y[top].mean()),
        'best_f1': float(f1.max()) if len(f1) else 0.0,
        'positives': int(y.sum()), 'total': int(len(y)),
    }


def thresholds(y, s):
    """Пороги решений по проверочной выборке: «высокий риск» — максимум F1; «повышенный» — 5 % ложных тревог."""
    p, r, t = precision_recall_curve(y, s)
    f1 = (2 * p * r / np.maximum(p + r, 1e-9))[:-1]
    high = float(t[int(np.argmax(f1))])
    low = float(min(np.quantile(s[y == 0], 0.95), high * 0.999))
    return {'high': high, 'elevated': low}


# ---------------------------------------------------------------- GraphSAGE
class SageLayer(nn.Module):
    """h' = ReLU( W₀·h  +  W_in·среднее(h отправителей)  +  W_out·среднее(h получателей) )"""
    def __init__(self, d_in, d_out):
        super().__init__()
        self.self_lin = nn.Linear(d_in, d_out)
        self.in_lin = nn.Linear(d_in, d_out, bias=False)
        self.out_lin = nn.Linear(d_in, d_out, bias=False)

    def forward(self, h, a_in, a_out):
        return self.self_lin(h) + self.in_lin(a_in @ h) + self.out_lin(a_out @ h)


class GraphSAGE(nn.Module):
    def __init__(self, d_in, hidden, layers, dropout):
        super().__init__()
        dims = [d_in] + [hidden] * layers
        self.layers = nn.ModuleList(SageLayer(a, b) for a, b in zip(dims[:-1], dims[1:]))
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(hidden, 1)

    def forward(self, x, a_in, a_out):
        h = x
        for layer in self.layers:
            h = self.drop(torch.relu(layer(h, a_in, a_out)))
        return self.head(h).squeeze(-1)


# ---------------------------------------------------------------- обучение
def train(params=None, callback=None):
    p = dict(DEFAULTS, **(params or {}))
    p = {k: type(DEFAULTS[k])(v) for k, v in p.items() if k in DEFAULTS}
    say = (lambda m: (print(m, flush=True), callback and callback(m)))
    t0 = time.time()
    torch.manual_seed(p['seed'])
    torch.set_num_threads(max(1, torch.get_num_threads()))

    g = load_graph()
    x, raw, y, edges = g['x'], g['raw'], g['y'].astype(np.int64), g['edges'].astype(np.int64)
    n = len(y)
    recipients = raw[:, 0] > 0
    split = make_split(y, recipients, p['seed'])
    tr, va, te = split == 1, split == 2, split == 3
    say(f'Счетов-получателей: {recipients.sum():_}; обучение {tr.sum():_}, проверка {va.sum():_}, тест {te.sum():_}.'.replace('_', ' '))

    results, scores_all = {}, {}

    # 1. Правило
    s = raw[:, 4]
    results['rule'] = evaluate(y[te], s[te])
    say('1/4 Правило: PR-AUC = %.3f' % results['rule']['pr_auc'])

    # 2. Логистическая регрессия
    lr = LogisticRegression(class_weight='balanced', max_iter=500).fit(x[tr], y[tr])
    results['logreg'] = evaluate(y[te], lr.predict_proba(x[te])[:, 1])
    say('2/4 Логистическая регрессия: PR-AUC = %.3f' % results['logreg']['pr_auc'])

    # 3. Бустинг по признакам счёта + средним признакам соседей (ручные «графовые признаки»)
    a_in, a_out = mean_adjacency(edges, n, False), mean_adjacency(edges, n, True)
    xt = torch.tensor(x)
    with torch.no_grad():
        xg = torch.cat([xt, a_in @ xt, a_out @ xt], 1).numpy()
    gb = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.1, class_weight='balanced', random_state=p['seed'])
    gb.fit(xg[tr], y[tr])
    results['boosting'] = evaluate(y[te], gb.predict_proba(xg[te])[:, 1])
    say('3/4 Градиентный бустинг: PR-AUC = %.3f' % results['boosting']['pr_auc'])

    # 4. GraphSAGE
    model = GraphSAGE(x.shape[1], p['hidden'], p['layers'], p['dropout'])
    opt = torch.optim.Adam(model.parameters(), lr=p['lr'], weight_decay=1e-5)
    yt = torch.tensor(y, dtype=torch.float32)
    tr_t, va_idx = torch.tensor(tr), np.where(va)[0]
    pos_weight = torch.tensor((y[tr] == 0).sum() / max(1, (y[tr] == 1).sum()))
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    best, best_state, curve = -1.0, None, []
    for epoch in range(1, p['epochs'] + 1):
        model.train(); opt.zero_grad()
        logits = model(xt, a_in, a_out)
        loss = loss_fn(logits[tr_t], yt[tr_t])
        loss.backward(); opt.step()
        if epoch % 5 == 0 or epoch == p['epochs']:
            model.eval()
            with torch.no_grad():
                sv = torch.sigmoid(model(xt, a_in, a_out)).numpy()
            val_ap = float(average_precision_score(y[va_idx], sv[va_idx]))
            curve.append({'epoch': epoch, 'loss': float(loss.detach()), 'val_pr_auc': val_ap})
            if val_ap > best:
                best, best_state = val_ap, {k: v.clone() for k, v in model.state_dict().items()}
            say(f'4/4 GraphSAGE: эпоха {epoch}/{p["epochs"]}, ошибка {float(loss.detach()):.4f}, PR-AUC на проверке {val_ap:.3f}')
    model.load_state_dict(best_state); model.eval()
    with torch.no_grad():
        scores = torch.sigmoid(model(xt, a_in, a_out)).numpy()
    results['graphsage'] = evaluate(y[te], scores[te])
    say('GraphSAGE на тесте: PR-AUC = %.3f' % results['graphsage']['pr_auc'])

    # Калибровка: сырую оценку сети переводим в вероятность «счёт — дроп» (изотоническая регрессия
    # на проверочной выборке). Так 0,12 означает «примерно 12 из 100 таких счетов — дропы».
    iso = IsotonicRegression(out_of_bounds='clip', y_min=0, y_max=1).fit(scores[va], y[va])
    prob = iso.predict(scores).astype(np.float32)

    # Сохранение: модель, оценки всех счетов, метрики, пороги, «типичный» счёт для объяснений.
    MODELS.mkdir(exist_ok=True)
    torch.save(best_state, MODELS / 'graphsage.pt')
    np.savez_compressed(MODELS / 'scores.npz', scores=scores.astype(np.float32), prob=prob, split=split)
    normal = recipients & (y == 0)
    report = {
        'trained_at': time.strftime('%Y-%m-%d %H:%M'), 'seconds': round(time.time() - t0),
        'params': p, 'models': {k: dict(v, title=MODEL_TITLES[k]) for k, v in results.items()},
        'thresholds': thresholds(y[va], prob[va]), 'curve': curve,
        'typical': np.median(raw[normal], 0).tolist(), 'typical_illicit': np.median(raw[recipients & (y == 1)], 0).tolist(),
        'feature_names': [str(f) for f in g['feature_names']],
        'dataset': {'accounts': int(n), 'edges': int(len(edges)), 'transactions': int(g['rows']),
                    'recipients': int(recipients.sum()), 'illicit_recipients': int(y[recipients].sum())},
    }
    (MODELS / 'metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    say(f'Готово за {report["seconds"]} с.')
    return report


if __name__ == '__main__':
    import sys
    train(json.loads(sys.argv[1]) if len(sys.argv) > 1 else None)
