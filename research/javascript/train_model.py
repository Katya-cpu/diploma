"""Train a light classifier on previously extracted, independently labelled AST facts.

Input JSON is a list of {'facts':[{'kind':...,'name':...}], 'label':...}.
Never execute source code to obtain features. Split scripts by campaign/source.
"""
import argparse
import json
from pathlib import Path
import joblib
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.pipeline import make_pipeline

def data(path):
    rows=json.loads(path.read_text(encoding='utf-8'))
    examples=[];labels=[]
    for row in rows:
        features={}
        for fact in row.get('facts',[]):
            key=str(fact.get('kind','unknown'))+':'+str(fact.get('name','unknown'))
            features[key]=features.get(key,0)+1
        examples.append(features);labels.append(row['label'])
    return examples,labels

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--train',type=Path,required=True);p.add_argument('--test',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    x,y=data(a.train);tx,ty=data(a.test)
    if len(set(y))<2:raise ValueError('Нужно не менее двух классов.')
    model=make_pipeline(DictVectorizer(),LogisticRegression(class_weight='balanced',max_iter=400,random_state=42));model.fit(x,y)
    a.out.mkdir(parents=True,exist_ok=True);joblib.dump(model,a.out/'js-model.joblib')
    report=classification_report(ty,model.predict(tx),output_dict=True,zero_division=0)
    (a.out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
