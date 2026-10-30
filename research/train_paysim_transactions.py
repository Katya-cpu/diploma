"""Compare transaction-level baselines with a GNN using strictly prior-day graph history.

PaySim is synthetic. Each day is a conservative batch: every candidate transaction
is classified using history before the day begins; intra-day history is not used.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
import torch
from torch import nn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from train_models import select_threshold, metrics

KINDS=('CASH_IN','CASH_OUT','DEBIT','PAYMENT','TRANSFER')

def build_snapshots(frame):
    required={'time','sender','recipient','amount','scenario_label','source_type'}
    if not required.issubset(frame.columns):raise ValueError('Нет необходимых полей PaySim.')
    frame=frame.copy();frame['time']=pd.to_datetime(frame['time'],utc=True);frame=frame.sort_values('time');frame['day']=frame.time.dt.floor('D')
    accounts=sorted(set(frame.sender)|set(frame.recipient));ids={name:i for i,name in enumerate(accounts)};result=[]
    for day in sorted(frame.day.unique())[2:]:
        cut=pd.Timestamp(day);past=frame[frame.time<cut];current=frame[frame.day==cut]
        if past.empty or current.empty:continue
        features=np.zeros((len(accounts),4),dtype=np.float32)
        incoming=past.groupby('recipient').amount.agg(['size','sum'])
        outgoing=past.groupby('sender').amount.agg(['size','sum'])
        for name,row in incoming.iterrows():features[ids[name],0:2]=[row['size'],row['sum']]
        for name,row in outgoing.iterrows():features[ids[name],2:4]=[row['size'],row['sum']]
        features=np.log1p(features)
        edges=np.array([(ids[s],ids[r]) for s,r in zip(past.sender,past.recipient)],dtype=np.int64).T
        sender=np.array([ids[x] for x in current.sender],dtype=np.int64);receiver=np.array([ids[x] for x in current.recipient],dtype=np.int64)
        kind=np.stack([(current.source_type==x).to_numpy(dtype=np.float32) for x in KINDS],axis=1)
        extra=np.concatenate((np.log1p(current.amount.to_numpy(dtype=np.float32))[:,None],kind),axis=1)
        y=(current.scenario_label=='paysim_fraud').to_numpy(dtype=np.int64)
        result.append({'day':str(cut),'x':features,'edges':edges,'sender':sender,'receiver':receiver,'extra':extra,'y':y})
    return result

class TransactionGNN(nn.Module):
    def __init__(self):
        super().__init__();self.layer=nn.Linear(8,16);self.head=nn.Sequential(nn.Linear(38,16),nn.ReLU(),nn.Linear(16,1))
    def forward(self,x,edges,sender,receiver,extra):
        source,target=edges;total=torch.zeros_like(x);total.index_add_(0,target,x[source])
        count=torch.zeros((x.size(0),1),dtype=x.dtype,device=x.device);count.index_add_(0,target,torch.ones((target.size(0),1),device=x.device))
        h=torch.relu(self.layer(torch.cat([x,total/count.clamp(min=1)],dim=1)))
        return self.head(torch.cat([h[sender],h[receiver],extra],dim=1)).squeeze(-1)

def tensor(day):
    return tuple(torch.tensor(day[k],dtype=d) for k,d in [('x',torch.float32),('edges',torch.long),('sender',torch.long),('receiver',torch.long),('extra',torch.float32)])

def classical(days):
    return (np.concatenate([np.concatenate([d['x'][d['sender']],d['x'][d['receiver']],d['extra']],axis=1) for d in days]),np.concatenate([d['y'] for d in days]))

def run(input_path,output,epochs,learning_rate,max_fpr):
    torch.manual_seed(42);np.random.seed(42)
    snapshots=build_snapshots(pd.read_csv(input_path))
    if len(snapshots)<10:raise ValueError('Нужно минимум 12 дней с операциями.')
    a,b=int(len(snapshots)*.6),int(len(snapshots)*.8);train,valid,test=snapshots[:a],snapshots[a:b],snapshots[b:]
    xtr,ytr=classical(train);xv,yv=classical(valid);xt,yt=classical(test)
    if len(set(ytr))<2:raise ValueError('В обучении только один класс. Увеличьте выборку.')
    result={'task':'transaction classification with graph history strictly before the day','split':'chronological 60/20/20 days; accounts may recur',
      'parameters':{'epochs':epochs,'learning_rate':learning_rate,'max_fpr':max_fpr},'counts':{'train':len(ytr),'validation':len(yv),'test':len(yt)},'models':{}}
    for name,model in [('logistic',make_pipeline(StandardScaler(),LogisticRegression(class_weight='balanced',max_iter=300))),('forest',RandomForestClassifier(n_estimators=80,class_weight='balanced',random_state=42,n_jobs=-1))]:
        model.fit(xtr,ytr);t=select_threshold(yv,model.predict_proba(xv)[:,1],max_fpr)
        result['models'][name]=metrics(yt,model.predict_proba(xt)[:,1],t)
    model=TransactionGNN();optimizer=torch.optim.Adam(model.parameters(),lr=learning_rate)
    weight=torch.tensor([max(1.,float((ytr==0).sum()/max(1,(ytr==1).sum())))])
    loss_fn=nn.BCEWithLogitsLoss(pos_weight=weight)
    for _ in range(epochs):
        model.train()
        for day in train:
            optimizer.zero_grad();loss=loss_fn(model(*tensor(day)),torch.tensor(day['y'],dtype=torch.float32));loss.backward();optimizer.step()
    def score(days):
        model.eval();probs=[];labels=[]
        with torch.no_grad():
            for day in days:probs.extend(torch.sigmoid(model(*tensor(day))).tolist());labels.extend(day['y'].tolist())
        return labels,probs
    yval,pval=score(valid);ytest,ptest=score(test);threshold=select_threshold(yval,pval,max_fpr)
    result['models']['transaction_gnn']=metrics(ytest,ptest,threshold)
    result['limitations']=['Synthetic PaySim, not real purchases or Mamont victims.','Random row sampling thins historical graph and is not a full-data evaluation.',
       'A daily cutoff conservatively excludes same-day prior operations; no verified within-hour order.','Chronological test includes accounts seen earlier; not an unseen-account generalization test.',
       'Threshold uses validation only; test positives can be too few for reliable conclusions.']
    output.mkdir(parents=True,exist_ok=True);(output/'metrics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    torch.save(model.state_dict(),output/'transaction-gnn.pt');print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--epochs',type=int,default=1);p.add_argument('--learning-rate',type=float,default=.002);p.add_argument('--max-fpr',type=float,default=.05);a=p.parse_args()
    if not 1<=a.epochs<=100 or not .00001<=a.learning_rate<=.1 or not 0<=a.max_fpr<=.5:p.error('Некорректные параметры.')
    run(a.input,a.output,a.epochs,a.learning_rate,a.max_fpr)
