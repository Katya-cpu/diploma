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
    weights=Path(__file__).resolve().parent/'results'/'graphsage.pt'
    if not weights.is_file():return {'status':'unknown','reason':'Веса не найдены. Сначала запустите учебное обучение графовой модели.'}
    model=GraphSAGE();model.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True));model.eval()
    with torch.no_grad():
        scores=model(torch.tensor(features,dtype=torch.float32),torch.tensor(edges,dtype=torch.long).t())
        score=float(torch.sigmoid(scores[ids[recipient]]))
    return {'status':'hypothesis','score':score,'count_before':counts[ids[recipient]],
            'note':'Учебная модель на искусственных данных; показатель не откалиброван, мошенничество не установлено.'}

if __name__=='__main__':
    try: print(json.dumps(predict(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as exc:print(json.dumps({'status':'unknown','reason':'Не удалось выполнить локальный графовый анализ.'},ensure_ascii=False))
