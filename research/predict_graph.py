"""Score a fictional recipient using only transaction history before a request.

Reads a single JSON request from stdin; never executes supplied content.
Requires weights from the separately initiated educational training.
"""
import json
import math
import sys
from pathlib import Path
import torch
from graph_model import GraphSAGE
if hasattr(sys.stdout,'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def predict(payload):
    request=payload['request'];cut=float(request['time']);recipient=str(request['recipient'])
    history=[x for x in payload['history'] if float(x['time'])<cut]
    if not history:return {'status':'unknown','reason':'Нет истории до заявки.'}
    accounts=sorted({str(x['sender']) for x in history}|{str(x['recipient']) for x in history}|{recipient})
    ids={name:i for i,name in enumerate(accounts)}
    n=len(accounts);counts=[0]*n;senders=[set() for _ in range(n)];amounts=[0.]*n;recent=[0]*n;recent_senders=[set() for _ in range(n)];edges=[]
    for row in history:
        sender=str(row['sender']);target=ids[str(row['recipient'])];amount=float(row['amount']);time=float(row['time'])
        if not math.isfinite(time) or not math.isfinite(amount) or amount<0:raise ValueError('Некорректные данные истории.')
        counts[target]+=1;senders[target].add(sender);amounts[target]+=amount;edges.append((ids[sender],target))
        if time>=cut-86400:recent[target]+=1;recent_senders[target].add(sender)
    features=[[math.log1p(v) for v in (counts[i],len(senders[i]),amounts[i],recent[i],len(recent_senders[i]))] for i in range(n)]
    if not counts[ids[recipient]]:return {'status':'unknown','reason':'Нет истории этого получателя до заявки.'}
    selection=payload.get('model','demo')
    directories={'demo':'results','paysim':'paysim-results'}
    if selection not in directories:return {'status':'unknown','reason':'Неизвестная модель.'}
    weights=Path(__file__).resolve().parent/directories[selection]/'graphsage.pt'
    if not weights.is_file():return {'status':'unknown','reason':'Веса выбранной модели не найдены. Сначала запустите соответствующее обучение.'}
    model=GraphSAGE();model.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True));model.eval()
    with torch.no_grad():
        scores=model(torch.tensor(features,dtype=torch.float32),torch.tensor(edges,dtype=torch.long).t())
        score=float(torch.sigmoid(scores[ids[recipient]]))
    metrics_file=weights.parent/'metrics.json';threshold=None;test_positive=None;test_recall=None
    if metrics_file.is_file():
        try:
            metrics=json.loads(metrics_file.read_text(encoding='utf-8')).get('models',{}).get('graphsage',{})
            candidate=metrics.get('threshold');test_positive=metrics.get('positive');test_recall=metrics.get('recall')
            if isinstance(candidate,(int,float)) and not isinstance(candidate,bool) and math.isfinite(candidate) and 0<=candidate<=1:threshold=float(candidate)
        except (ValueError,OSError,TypeError):pass
    failed_test=isinstance(test_positive,int) and test_positive>0 and isinstance(test_recall,(float,int)) and test_recall==0
    decision='unknown' if threshold is None or failed_test else ('suspend' if score>=threshold else 'proceed')
    warning='На учебном тесте модель не обнаружила ни одного положительного случая, поэтому решение не выдаётся.' if failed_test else ''
    return {'status':'hypothesis','score':score,'count_before':counts[ids[recipient]],
            'threshold':threshold,'decision':decision,'warning':warning,
            'note':'Учебная модель на искусственных данных ('+selection+'); показатель не откалиброван, мошенничество не установлено. Порог получен на учебной валидации.'}

if __name__=='__main__':
    try: print(json.dumps(predict(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as exc:print(json.dumps({'status':'unknown','reason':'Не удалось выполнить локальный графовый анализ.'},ensure_ascii=False))
