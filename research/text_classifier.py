"""Train and evaluate a local text baseline on separately labelled CSV files.

Each CSV needs text,label; labels must be independently established. Do not use
actual card numbers, CVV, passwords, cookies or private correspondence.
"""
import argparse
import json
from pathlib import Path
import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.pipeline import make_pipeline

def read(path):
    df=pd.read_csv(path).dropna(subset=['text','label'])
    df['text']=df.text.astype(str).str.slice(0,5000)
    df['label']=df.label.astype(str)
    return df

def main():
    p=argparse.ArgumentParser();p.add_argument('--train',type=Path,required=True);p.add_argument('--test',type=Path,required=True);p.add_argument('--out',type=Path,default=Path('research/text-model'));a=p.parse_args()
    train,test=read(a.train),read(a.test)
    if train.text.isin(test.text).any():raise ValueError('Одинаковые тексты в обучении и оценке. Уберите пересечения.')
    if train.label.nunique()<2:raise ValueError('Нужно минимум два класса в обучающей выборке.')
    model=make_pipeline(TfidfVectorizer(analyzer='char',ngram_range=(2,5),min_df=2),LogisticRegression(class_weight='balanced',max_iter=500,random_state=42))
    model.fit(train.text,train.label)
    report=classification_report(test.label,model.predict(test.text),output_dict=True,zero_division=0)
    a.out.mkdir(parents=True,exist_ok=True)
    joblib.dump(model,a.out/'model.joblib')
    (a.out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Модель и отчёт сохранены в',a.out)
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
