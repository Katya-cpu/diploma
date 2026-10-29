"""Optional CRF baseline for manually annotated token spans.

JSON: [{"tokens":["Оплатите","100","рублей"],"tags":["O","B-AMOUNT","I-AMOUNT"]}].
Provide separately curated train/test files; never use real sensitive data.
"""
import argparse
import json
from pathlib import Path
import joblib
import sklearn_crfsuite
from sklearn_crfsuite import metrics

def features(tokens,index):
    word=tokens[index]
    out={'bias':1.0,'lower':word.lower(),'suffix3':word[-3:].lower(),'isdigit':word.isdigit(),'istitle':word.istitle()}
    if index:out['prev.lower']=tokens[index-1].lower()
    if index+1<len(tokens):out['next.lower']=tokens[index+1].lower()
    return out

def load(path):
    rows=json.loads(path.read_text(encoding='utf-8'))
    x=[];y=[]
    for row in rows:
        tokens,tags=row['tokens'],row['tags']
        if len(tokens)!=len(tags):raise ValueError('Количество токенов и меток различается')
        x.append([features(tokens,i) for i in range(len(tokens))]);y.append(tags)
    return x,y

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--train',type=Path,required=True);p.add_argument('--test',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    x,y=load(a.train);xt,yt=load(a.test)
    model=sklearn_crfsuite.CRF(algorithm='lbfgs',c1=.1,c2=.1,max_iterations=100);model.fit(x,y)
    report=metrics.flat_classification_report(yt,model.predict(xt),output_dict=True,zero_division=0)
    a.out.mkdir(parents=True,exist_ok=True);joblib.dump(model,a.out/'crf.joblib')
    (a.out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
