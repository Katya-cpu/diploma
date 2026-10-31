"""API раздела «Граф транзакций» для лаборатории (вызывается из server.py).

GET  /api/graph/status    — есть ли датасет, подготовлен ли граф, обучена ли модель, метрики
GET  /api/graph/job       — ход текущей задачи (скачивание / подготовка / обучение)
GET  /api/graph/examples  — примеры счетов для имитации перевода
POST /api/graph/download  — скачать датасет (~480 МБ)
POST /api/graph/prepare   — построить граф и признаки
POST /api/graph/train     — обучить модели с параметрами из админки
POST /api/graph/check     — имитация перевода: оценка риска счёта-получателя
GET  /api/graph/research  — результаты исследования схем (по типам, карта t-SNE, владельцы)
GET  /api/graph/pattern?id=N — подграф одной схемы отмывания с соседями для визуализации
POST /api/graph/research  — пересчитать исследование
"""
import json
import threading
import time
import urllib.request
from pathlib import Path
import numpy as np

from . import prepare as prep
from . import train as tr
from . import research as rs

DATASET_URL = 'https://huggingface.co/datasets/bbfizp/AMLSim-HI-Small/resolve/main/HI-Small_Trans.csv'
DATASET_SIZE = 475_643_652  # байт, для индикатора скачивания (приблизительно)


class ApiError(Exception):
    pass


# ---------------------------------------------------------------- фоновые задачи
JOB = {'kind': None, 'running': False, 'log': [], 'error': None, 'started': None}
LOCK = threading.Lock()


def run_job(kind, fn):
    with LOCK:
        if JOB['running']:
            raise ApiError('Уже выполняется задача: ' + JOB['kind'])
        JOB.update(kind=kind, running=True, log=[], error=None, started=time.time())

    def work():
        try:
            fn(lambda m: JOB['log'].append(m))
        except Exception as e:  # показываем ошибку в админке
            JOB['error'] = str(e)
        finally:
            JOB['running'] = False
            CACHE.clear()
    threading.Thread(target=work, daemon=True).start()
    return {'started': kind}


def download(say):
    prep.CSV.parent.mkdir(parents=True, exist_ok=True)
    part = prep.CSV.with_suffix('.part')
    have = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(DATASET_URL, headers={'Range': f'bytes={have}-'} if have else {})
    with urllib.request.urlopen(req, timeout=60) as r, open(part, 'ab') as f:
        last = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk); have += len(chunk)
            if have - last > 25 << 20:
                last = have
                say(f'Скачано {have >> 20} МБ из ~{DATASET_SIZE >> 20} МБ')
    part.replace(prep.CSV)
    say('Датасет скачан.')


# ---------------------------------------------------------------- данные для имитации (кэш в памяти)
CACHE = {}


def state():
    if 'g' not in CACHE:
        if not prep.OUT.exists() or not (tr.MODELS / 'scores.npz').exists():
            raise ApiError('Сначала подготовьте граф и обучите модель на вкладке «Модель».')
        g = tr.load_graph()
        s = np.load(tr.MODELS / 'scores.npz')
        edges = g['edges'].astype(np.int64)
        CACHE.update(
            g=g, scores=s['prob'], raw_scores=s['scores'], split=s['split'],
            metrics=json.loads((tr.MODELS / 'metrics.json').read_text(encoding='utf-8')),
            index={k: i for i, k in enumerate(g['keys'])},
            by_src=np.argsort(edges[:, 0], kind='stable'), by_dst=np.argsort(edges[:, 1], kind='stable'), edges=edges,
        )
    return CACHE


def neighbors(c, i, side, limit=6):
    """Отправители (side=1: рёбра X→i) или получатели (side=0: рёбра i→X) счёта i."""
    e, order = c['edges'], c['by_dst'] if side == 1 else c['by_src']
    col = e[order, side]
    lo, hi = np.searchsorted(col, i, 'left'), np.searchsorted(col, i, 'right')
    other = e[order[lo:hi], 1 - side]
    other = other[np.argsort(-c['scores'][other])][:limit]
    return [{'account': str(c['g']['keys'][j]), 'score': float(c['scores'][j]), 'label': int(c['g']['y'][j])} for j in other], int(hi - lo)


def decide(score, thr):
    if score >= thr['high']:
        return 'high'
    if score >= thr['elevated']:
        return 'elevated'
    return 'low'


def explain(c, i):
    """Чем этот счёт отличается от типичного честного получателя (медиана)."""
    raw, names, typical = c['g']['raw'][i], c['metrics']['feature_names'], c['metrics']['typical']
    rows = []
    for j, name in enumerate(names):
        v, t = float(raw[j]), float(typical[j])
        if j >= 10 and v == 0 and t == 0:
            continue  # доли способов оплаты, которых у счёта нет
        ratio = (v + 1e-3) / (t + 1e-3)
        rows.append({'name': name, 'value': v, 'typical': t, 'ratio': ratio})
    rows.sort(key=lambda r: -abs(np.log(r['ratio'])))
    return rows[:8]


def check(payload):
    c = state()
    key = str(payload.get('recipient', '')).strip()
    sender = str(payload.get('sender', '')).strip()
    amount = float(payload.get('amount') or 0)
    thr = c['metrics']['thresholds']
    if key not in c['index']:
        return {'known': False, 'decision': 'unknown', 'recipient': key,
                'message': 'Этот счёт ни разу не встречался в истории переводов. Модели не на что опереться — '
                           'решение «недостаточно данных». Это не означает, что счёт безопасен.'}
    i = c['index'][key]
    score = float(c['scores'][i])
    senders, n_in = neighbors(c, i, 1)
    receivers, n_out = neighbors(c, i, 0)
    raw = c['g']['raw'][i]
    result = {
        'known': True, 'recipient': key, 'score': score, 'decision': decide(score, thr), 'thresholds': thr,
        'in_split': {0: 'не участвовал', 1: 'обучающая', 2: 'проверочная', 3: 'тестовая'}[int(c['split'][i])],
        'true_label': int(c['g']['y'][i]), 'explain': explain(c, i),
        'senders': senders, 'receivers': receivers, 'n_senders': n_in, 'n_receivers': n_out,
        'avg_incoming': float(raw[2] / max(raw[0], 1)),
    }
    if sender:
        if sender in c['index']:
            j = c['index'][sender]
            e = c['edges']
            result['first_transfer'] = not bool(((e[:, 0] == j) & (e[:, 1] == i)).any())
        else:
            result['first_transfer'] = True
    if amount and result['avg_incoming']:
        result['amount_ratio'] = amount / result['avg_incoming']
    return result


def examples():
    """Примеры из ТЕСТОВОЙ выборки (модель их не видела): верно найденные, пропущенные, ложные тревоги, обычные."""
    c = state()
    y, s, split, keys = c['g']['y'], c['scores'], c['split'], c['g']['keys']
    thr = c['metrics']['thresholds']['high']
    te = split == 3
    rng = np.random.default_rng(7)

    def pick(mask, k, title):
        idx = np.where(mask)[0]
        if not len(idx):
            return []
        idx = rng.choice(idx, size=min(k, len(idx)), replace=False)
        return [{'account': str(keys[i]), 'group': title, 'score': float(s[i]), 'label': int(y[i])} for i in idx]
    return {'items':
            pick(te & (y == 1) & (s >= thr), 3, 'Дроп, модель распознала') +
            pick(te & (y == 1) & (s < thr), 2, 'Дроп, модель пропустила') +
            pick(te & (y == 0) & (s >= thr), 1, 'Честный счёт, ложная тревога') +
            pick(te & (y == 0) & (s < thr), 3, 'Честный счёт') +
            [{'account': '999999:NEW000001', 'group': 'Новый счёт без истории', 'score': None, 'label': None}]}


def pattern(full_path):
    """Подграф схемы: счета схемы, её переводы по времени и до 2 соседей каждого счёта вне схемы."""
    from urllib.parse import urlparse, parse_qs
    c = state()
    pid = int(parse_qs(urlparse(full_path).query).get('id', ['0'])[0])
    if 'patterns' not in CACHE:
        CACHE['patterns'] = json.loads((tr.MODELS / 'patterns.json').read_text(encoding='utf-8'))
    a = CACHE['patterns'][pid]
    keys, prob, y = c['g']['keys'], c['scores'], c['g']['y']
    core = set(a['accounts'])
    nodes = {i: 'core' for i in core}
    links = []
    for i in core:
        for side in (1, 0):
            nb, _ = neighbors(c, i, side, limit=2)
            for n in nb:
                j = c['index'][n['account']]
                if j not in nodes:
                    nodes[j] = 'nb'
                links.append({'s': int(j if side == 1 else i), 't': int(i if side == 1 else j)})
    txns = [{'s': c['index'].get(t['from']), 't': c['index'].get(t['to']), 'time': t['t'], 'amount': t['amount'],
             'currency': t['currency']} for t in a['txns']]
    return {'id': pid, 'type': a['type'], 'name': rs.TYPES[a['type']][0], 'detail': a['detail'],
            'nodes': [{'id': int(i), 'account': str(keys[i]), 'role': r, 'prob': float(prob[i]), 'label': int(y[i]),
                       'split': int(c['split'][i])} for i, r in nodes.items()],
            'links': links, 'txns': txns, 'threshold': c['metrics']['thresholds']['high']}


def status():
    out = {'dataset': {'path': str(prep.CSV), 'exists': prep.CSV.exists(),
                       'size_mb': round(prep.CSV.stat().st_size / 2**20) if prep.CSV.exists() else 0},
           'prepared': prep.OUT.exists(), 'model': None, 'defaults': tr.DEFAULTS}
    m = tr.MODELS / 'metrics.json'
    if m.exists():
        out['model'] = json.loads(m.read_text(encoding='utf-8'))
    return out


def handle(method, route, payload, full_path):
    if method == 'GET' and route == '/api/graph/status':
        return status()
    if method == 'GET' and route == '/api/graph/job':
        return {k: JOB[k] for k in ('kind', 'running', 'log', 'error')}
    if method == 'GET' and route == '/api/graph/examples':
        return examples()
    if method == 'POST' and route == '/api/graph/download':
        return run_job('Скачивание датасета', download)
    if method == 'POST' and route == '/api/graph/prepare':
        return run_job('Подготовка графа', lambda say: prep.prepare(say))
    if method == 'POST' and route == '/api/graph/train':
        return run_job('Обучение моделей', lambda say: (tr.train(payload, say), CACHE.clear(), rs.run(say)))
    if method == 'GET' and route == '/api/graph/research':
        if not rs.OUT.exists():
            raise ApiError('Исследование ещё не выполнено: нажмите «4. Исследование схем» на вкладке «Модель и обучение».')
        return json.loads(rs.OUT.read_text(encoding='utf-8'))
    if method == 'GET' and route == '/api/graph/pattern':
        return pattern(full_path)
    if method == 'POST' and route == '/api/graph/research':
        return run_job('Исследование схем', lambda say: rs.run(say))
    if method == 'POST' and route == '/api/graph/check':
        return check(payload)
    raise ApiError('Неизвестный запрос: ' + route)
