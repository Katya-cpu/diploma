"""Compare historical-feature baselines and a small graph model on labelled CSV.

Only earlier transactions are included in each daily graph. Generated labels are
retrospective targets and are never included as features. Run on another computer.
"""
import argparse
import json
import hashlib
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from graph_model import GraphSAGE
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_fscore_support, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

def snapshots(frame):
    frame=frame.sort_values('time').copy()
    frame['time']=pd.to_datetime(frame['time'], utc=True)
    frame['day']=frame.time.dt.floor('D')
    days=sorted(frame.day.unique())
    accounts=sorted(set(frame.sender)|set(frame.recipient))
    nodes={name:i for i,name in enumerate(accounts)}
    result=[]
    for day in days[2:]:
        cut=pd.Timestamp(day)
        history=frame[frame.time<cut]
        if history.empty: continue
        incoming=history.groupby('recipient').agg(count=('sender','size'),senders=('sender','nunique'),total=('amount','sum'))
        recent_cut=cut.to_pydatetime()-timedelta(days=1)
        recent=history[history.time>=recent_cut].groupby('recipient').agg(recent=('sender','size'),recent_senders=('sender','nunique'))
        features=np.zeros((len(accounts),5),dtype=np.float32)
        for account,row in incoming.iterrows():
            idx=nodes[account];features[idx,:3]=[row['count'],row['senders'],row['total']]
        for account,row in recent.iterrows():features[nodes[account],3:]=[row['recent'],row['recent_senders']]
        features=np.log1p(features)
        edges=np.asarray([(nodes[s],nodes[r]) for s,r in zip(history.sender,history.recipient)],dtype=np.int64).T
        today=frame[frame.day==cut]
        y=today.groupby('recipient').scenario_label.apply(lambda s:int(s.isin(['simulated_scam','aml_suspicious','paysim_fraud']).any()))
        ids=np.asarray([nodes[a] for a in y.index],dtype=np.int64)
        result.append({'day':str(cut),'features':features,'edges':edges,'ids':ids,'labels':y.to_numpy(dtype=np.int64),'accounts':accounts})
    return result

def select_threshold(y,prob,max_fpr=0.05):
    if len(y)==0 or len(set(y))<2:return None
    scores=np.asarray(prob);labels=np.asarray(y);best=None
    for threshold in np.linspace(0,1,101):
        pred=scores>=threshold;negative=labels==0;positive=labels==1
        fpr=float(pred[negative].mean())
        if fpr>max_fpr:continue
        tp=int((pred&positive).sum());fp=int((pred&negative).sum());fn=int((~pred&positive).sum())
        f1=(2*tp/(2*tp+fp+fn)) if (2*tp+fp+fn) else 0.0
        if best is None or f1>best[0]:best=(f1,float(threshold))
    return best[1] if best else None

def metrics(y,prob,threshold):
    if len(set(y))<2:return {'error':'Метрики не вычислены: в выборке только один класс.'}
    result={'n':len(y),'positive':int(sum(y)),'threshold':threshold,'pr_auc':float(average_precision_score(y,prob)),'roc_auc':float(roc_auc_score(y,prob))}
    if threshold is None:result['threshold_status']='unknown: в validation недостаточно классов';return result
    pred=np.asarray(prob)>=threshold
    precision,recall,f1,_=precision_recall_fscore_support(y,pred,average='binary',zero_division=0)
    result.update({'precision':float(precision),'recall':float(recall),'f1':float(f1),'fpr':float(pred[np.asarray(y)==0].mean())})
    return result

def train(input_csv, output_dir, epochs=15, learning_rate=0.002, max_fpr=0.05):
    import torch
    from torch import nn
    torch.manual_seed(42);np.random.seed(42)
    df=pd.read_csv(input_csv)
    required={'time','sender','recipient','amount','scenario_label'}
    missing=required-set(df.columns)
    if missing: raise ValueError(f'Нет полей: {sorted(missing)}')
    data=snapshots(df)
    if len(data)<10:raise ValueError('Нужно минимум 12 разных дней с данными')
    a,b=int(len(data)*.6),int(len(data)*.8)
    def assigned(name):
        value=int.from_bytes(hashlib.sha256(name.encode('utf-8')).digest()[:4],'big')%100
        return 'train' if value<60 else 'validation' if value<80 else 'test'
    def choose(days,group):
        selected=[]
        for day in days:
            mask=np.asarray([assigned(day['accounts'][i])==group for i in day['ids']],dtype=bool)
            if not mask.any():continue
            selected.append({**day,'ids':day['ids'][mask],'labels':day['labels'][mask]})
        return selected
    trainset,valid,test=choose(data[:a],'train'),choose(data[a:b],'validation'),choose(data[b:],'test')
    if not trainset or not test:raise ValueError('Пустая обучающая или оценочная выборка после разделения по времени и получателям.')
    def matrix(days):
        return np.concatenate([d['features'][d['ids']] for d in days]),np.concatenate([d['labels'] for d in days])
    xtrain,ytrain=matrix(trainset);xtest,ytest=matrix(test)
    xvalid,yvalid=matrix(valid) if valid else (None,np.asarray([]))
    if len(set(ytrain))<2:raise ValueError('Обучающая выборка содержит один класс; измените исходные данные.')
    results={'split':'chronological days and disjoint recipient hash groups 60/20/20','parameters':{'epochs':epochs,'learning_rate':learning_rate,'max_fpr':max_fpr},'target_labels':sorted(df.scenario_label.astype(str).unique().tolist()),'counts':{'train':len(trainset),'validation':len(valid),'test':len(test)},'models':{}}
    for name,model in [('logistic',make_pipeline(StandardScaler(),LogisticRegression(class_weight='balanced',max_iter=300))),
                       ('forest',RandomForestClassifier(n_estimators=120,class_weight='balanced',random_state=42,n_jobs=-1))]:
        model.fit(xtrain,ytrain);threshold=select_threshold(yvalid,model.predict_proba(xvalid)[:,1],max_fpr) if valid else None
        results['models'][name]=metrics(ytest,model.predict_proba(xtest)[:,1],threshold)

    model=GraphSAGE();optim=torch.optim.Adam(model.parameters(),lr=learning_rate)
    weight=torch.tensor([max(1.0, float((ytrain==0).sum()/max(1,(ytrain==1).sum())))])
    lossfn=nn.BCEWithLogitsLoss(pos_weight=weight)
    def tensors(d):return (torch.tensor(d['features']),torch.tensor(d['edges']),torch.tensor(d['ids']),torch.tensor(d['labels'],dtype=torch.float32))
    for epoch in range(epochs):
        model.train()
        for day in trainset:
            x,e,idx,y=tensors(day);optim.zero_grad();loss=lossfn(model(x,e)[idx],y);loss.backward();optim.step()
    probs=[];labels=[];validation_probs=[];validation_labels=[];model.eval()
    with torch.no_grad():
        for day in valid:
            x,e,idx,y=tensors(day);validation_probs.extend(torch.sigmoid(model(x,e)[idx]).tolist());validation_labels.extend(y.tolist())
        for day in test:
            x,e,idx,y=tensors(day);probs.extend(torch.sigmoid(model(x,e)[idx]).tolist());labels.extend(y.tolist())
    threshold=select_threshold(validation_labels,validation_probs,max_fpr)
    results['models']['graphsage']=metrics(labels,probs,threshold)
    results['limitations']=['Synthetic data only; no real-world deployment claim.','Labels are scenario labels, not evidence about real accounts.',
       'Graphs contain historical edges only; day-level prediction is not a per-transfer online evaluation.',
       'Recipients are disjoint, but related accounts or whole scam campaigns may still span splits; additional campaign holdout is required.',
       'Threshold is selected on validation under an empirical FPR cap; this is not probability calibration and can fail on small samples.']
    output_dir.mkdir(parents=True,exist_ok=True)
    (output_dir/'metrics.json').write_text(json.dumps(results,indent=2,ensure_ascii=False),encoding='utf-8')
    torch.save(model.state_dict(),output_dir/'graphsage.pt')
    print(json.dumps(results,indent=2,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output',type=Path,default=Path('research/results'))
    parser.add_argument('--epochs',type=int,default=15);parser.add_argument('--learning-rate',type=float,default=0.002);parser.add_argument('--max-fpr',type=float,default=0.05);args=parser.parse_args()
    if not 1<=args.epochs<=100 or not 0.00001<=args.learning_rate<=0.1 or not 0<=args.max_fpr<=0.5:parser.error('Некорректные параметры обучения')
    train(args.input,args.output,args.epochs,args.learning_rate,args.max_fpr)
